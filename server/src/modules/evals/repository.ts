import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow, PullRow } from '../../db/rows.js';

/**
 * L06 — the evals data layer (plan S3).
 *
 * ## The one rule every query here obeys
 *
 * **`eval_runs` is never reached without joining `eval_cases`.** The runs table
 * has no `workspace_id` of its own — tenancy is transitive through its case
 * (`db/schema/eval.ts:23-25`), so a query that starts at `eval_runs` and filters
 * only on a `batch_id` or a `case_id` taken from the URL is a cross-workspace
 * read waiting to happen. Every read below therefore begins with, or inner-joins
 * to, `eval_cases` and filters on `eval_cases.workspace_id`.
 *
 * Cross-workspace misses return `undefined` / `[]` here and become a **404** at
 * the service, never a 403 — a 403 confirms the row exists.
 *
 * ## `batch_id` lives in jsonb
 *
 * The feature adds no column (both tables ship in `0000_init.sql`), so a run's
 * batch is `actual_output->>'batch_id'` and the batch list is a GROUP BY over
 * that expression. It cannot be indexed; at this scale that is fine, and the
 * honest fix later is a real column, i.e. a migration and a new decision (spec
 * open question 1) — not a cleverer query bolted on here.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean;
  recall: number;
  precision: number;
  citationAccuracy: number;
  durationMs: number;
  costUsd: number | null;
}

/** One linked skill, with everything REC-6's snapshot needs (body → hash). */
export interface AgentSkillSnapshotRow {
  id: string;
  name: string;
  version: number;
  body: string;
}

/** A batch aggregate, straight out of the GROUP BY (metrics still raw). */
export interface BatchAggregateRow {
  batchId: string;
  /** The agent that owns this batch's cases — a batch never spans two. */
  ownerId: string;
  ranAt: Date | string;
  recall: number;
  precision: number;
  citationAccuracy: number;
  tracesPassed: number;
  tracesTotal: number;
  costUsd: number | null;
  /** The newest row's `actual_output.agent`, or null when no row carried one. */
  agent: unknown;
}

/** A run row plus the attribution the workspace dashboard needs (REC-1). */
export interface RunWithCaseRow {
  run: EvalRunRow;
  caseName: string;
  ownerId: string;
  agentName: string | null;
  /** The case's `expected_output`, so a reader can re-derive TP/FP for REC-2. */
  expectedOutput: unknown;
}

/** `actual_output->>'batch_id'` — one expression, reused by SELECT and GROUP BY. */
const BATCH_ID = sql<string>`${t.evalRuns.actualOutput}->>'batch_id'`;

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- cases ---------------------------------------------------------------

  /** Every case owned by one agent, oldest first (a stable run order). */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(asc(t.evalCases.name), asc(t.evalCases.id));
  }

  /** Every case in the workspace — the workspace dashboard's `cases_total`. */
  async countCases(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));
    return row?.n ?? 0;
  }

  /** Case counts per owning agent — the workspace dashboard's per-agent table. */
  async countCasesByAgent(workspaceId: string): Promise<{ ownerId: string; n: number }[]> {
    return this.db
      .select({ ownerId: t.evalCases.ownerId, n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /**
   * AC-5's idempotency key. There is no unique index to lean on (no migration),
   * so the key is `input_meta->>'finding_id'` and the guarantee is "read before
   * write" in the service. Two simultaneous clicks on the same finding could
   * still both insert; the loser is a duplicate case, not a corrupt one, and the
   * UI offers one button per finding.
   */
  async findCaseByFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          sql`${t.evalCases.inputMeta}->>'finding_id' = ${findingId}`,
        ),
      )
      .orderBy(asc(t.evalCases.id))
      .limit(1);
    return row;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({ ...values, ownerKind: 'agent' })
      .returning();
    return row!;
  }

  /** Returns false when no such case exists IN THIS WORKSPACE (→ 404). */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs ----------------------------------------------------------------

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db.insert(t.evalRuns).values(values).returning();
    return row!;
  }

  /**
   * The batch list (BQ-4a) — one row per `batch_id`, newest first.
   *
   * `avg()` over `double precision` comes back as a JS number; the three metric
   * columns are `doublePrecision`, so no numeric→string surprise. `count(*)` is
   * cast to `int` because postgres-js returns `bigint` as a string otherwise.
   *
   * `traces_total` is a COUNT of the rows actually written, which is what makes
   * a partial batch (Edge-7 / CR-5) legible: a run that died mid-set leaves a
   * batch whose `traces_total` is below the agent's case count, and this list is
   * where a client that lost its connection goes to see that.
   */
  async listBatches(workspaceId: string, agentId?: string): Promise<BatchAggregateRow[]> {
    const where = agentId
      ? and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        )
      : eq(t.evalCases.workspaceId, workspaceId);

    const rows = await this.db
      .select({
        batchId: BATCH_ID,
        // A `batch_id` is minted per run of ONE agent's set, so every row in
        // the group shares an owner; `array_agg(...)[1]` reads it without
        // needing a `min(uuid)` aggregate, which Postgres does not have.
        ownerId: sql<string>`(array_agg(${t.evalCases.ownerId}))[1]`,
        ranAt: sql<Date>`max(${t.evalRuns.ranAt})`,
        recall: sql<number>`avg(coalesce(${t.evalRuns.recall}, 0))::double precision`,
        precision: sql<number>`avg(coalesce(${t.evalRuns.precision}, 0))::double precision`,
        citationAccuracy: sql<number>`avg(coalesce(${t.evalRuns.citationAccuracy}, 0))::double precision`,
        tracesPassed: sql<number>`count(*) filter (where ${t.evalRuns.pass})::int`,
        tracesTotal: sql<number>`count(*)::int`,
        costUsd: sql<number | null>`sum(${t.evalRuns.costUsd})::double precision`,
        // The newest row's snapshot. `agent` is nullable in `EvalBatchSummary`
        // precisely because a hand-seeded row need not carry one.
        agent: sql<unknown>`(array_agg(${t.evalRuns.actualOutput}->'agent' order by ${t.evalRuns.ranAt} desc))[1]`,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(where, sql`${t.evalRuns.actualOutput}->>'batch_id' is not null`))
      .groupBy(BATCH_ID)
      .orderBy(sql`max(${t.evalRuns.ranAt}) desc`);

    return rows;
  }

  /** Every row of one batch — workspace-guarded through its case. */
  async runsForBatch(workspaceId: string, batchId: string): Promise<RunWithCaseRow[]> {
    const rows = await this.db
      .select({
        run: t.evalRuns,
        caseName: t.evalCases.name,
        ownerId: t.evalCases.ownerId,
        agentName: t.agents.name,
        expectedOutput: t.evalCases.expectedOutput,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .leftJoin(t.agents, eq(t.agents.id, t.evalCases.ownerId))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), sql`${BATCH_ID} = ${batchId}`))
      .orderBy(asc(t.evalCases.name));
    return rows;
  }

  /**
   * Recent runs, newest first — the dashboard's `recent_runs`.
   *
   * The `agents` LEFT JOIN is REC-1's belt to the envelope's braces: a run's
   * agent normally comes out of `actual_output.agent` (the snapshot, which is
   * what makes an old run still readable after the agent is renamed), but a row
   * whose envelope predates or omits the snapshot would otherwise be
   * unattributable, and `EvalRunRecord` has no agent field to fall back on.
   * LEFT, not INNER: a deleted agent must not make its runs vanish from history.
   */
  async recentRuns(
    workspaceId: string,
    opts: { agentId?: string; limit: number },
  ): Promise<RunWithCaseRow[]> {
    const where = opts.agentId
      ? and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, opts.agentId),
        )
      : eq(t.evalCases.workspaceId, workspaceId);

    return this.db
      .select({
        run: t.evalRuns,
        caseName: t.evalCases.name,
        ownerId: t.evalCases.ownerId,
        agentName: t.agents.name,
        expectedOutput: t.evalCases.expectedOutput,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .leftJoin(t.agents, eq(t.agents.id, t.evalCases.ownerId))
      .where(where)
      .orderBy(desc(t.evalRuns.ranAt), desc(t.evalRuns.id))
      .limit(opts.limit);
  }

  // ---- inputs the run loop needs -------------------------------------------

  /**
   * REC-6's snapshot source: id + name + version + body for the ENABLED skills
   * linked to an agent, in their configured order.
   *
   * A deliberate SIBLING of `reviews/repository/skill.repo.ts`'s
   * `getAgentSkillBodies`, not an edit to it. That query is the review
   * pipeline's, returns bodies only, and is called on every live review; adding
   * columns to it to serve the eval snapshot would change a hot shared path for
   * one caller's benefit. The one guarantee it documents is copied here on
   * purpose: **disabled skills are filtered in SQL**, so no caller can forget
   * that a skill toggled off in the UI must not reach the model — or the hash.
   *
   * There is NO `slug` column on `skills` (`db/schema/skills.ts:5-21`); the
   * snapshot keys on `{id, name, version, content_hash}` and `version` — already
   * bumped on every edit — is a second, free staleness signal.
   */
  async agentSkillsForSnapshot(agentId: string): Promise<AgentSkillSnapshotRow[]> {
    return this.db
      .select({
        id: t.skills.id,
        name: t.skills.name,
        version: t.skills.version,
        body: t.skills.body,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
      .orderBy(asc(t.agentSkills.order));
  }

  /**
   * A finding with the review and PR it belongs to, scoped to the workspace in
   * SQL. Cross-workspace (and missing) both return `undefined`, which the
   * service turns into one indistinguishable 404.
   *
   * Written here rather than reused from `reviews/repository`: that module's
   * `findingContext` does three unscoped lookups and leaves tenancy to its
   * caller, which is fine there and is exactly the thing not to copy into a new
   * module.
   */
  async findingContext(
    workspaceId: string,
    findingId: string,
  ): Promise<{ finding: FindingRow; reviewAgentId: string | null; pull: PullRow } | undefined> {
    const [row] = await this.db
      .select({
        finding: t.findings,
        reviewAgentId: t.reviews.agentId,
        pull: t.pullRequests,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .where(and(eq(t.findings.id, findingId), eq(t.reviews.workspaceId, workspaceId)));
    return row;
  }

  /** Agents in the workspace that own at least one eval case. */
  async agentsWithCases(workspaceId: string): Promise<{ id: string; name: string }[]> {
    return this.db
      .selectDistinct({ id: t.agents.id, name: t.agents.name })
      .from(t.evalCases)
      .innerJoin(t.agents, eq(t.agents.id, t.evalCases.ownerId))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .orderBy(asc(t.agents.name));
  }
}
