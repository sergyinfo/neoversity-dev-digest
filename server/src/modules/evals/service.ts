import { createHash, randomUUID } from 'node:crypto';
import type {
  EvalCase,
  EvalDashboard,
  EvalRunRecord,
  EvalRunResult,
  EvalTrendPoint,
  Provider,
} from '@devdigest/shared';
import { FindingCategory, Severity } from '@devdigest/shared';
import { reviewPullRequest, sliceDiff } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { diffFromPrFiles } from '../reviews/diff-loader.js';
import {
  ActualOutput,
  EvalBatchSummary,
  ExpectedOutput,
  type EvalAgentSnapshot,
  type EvalExpectation,
} from './contract.js';
import { EvalsRepository, type BatchAggregateRow, type RunWithCaseRow } from './repository.js';
import { classifyFindings, score } from './scoring.js';

/**
 * L06 — the eval pipeline service (plan S4): case creation, the synchronous run
 * loop, and the two dashboards.
 *
 * ## What a run is allowed to touch (AC-7)
 *
 * A run reads **the stored case and nothing else**. `reviewPullRequest` is
 * called with exactly five keys — `systemPrompt`, `model`, `diff`, `llm`,
 * `skills` — and no repo-intel, project-context, PR description, intent, task
 * line or live `sessionId`. That is the whole point of the feature: "two runs of
 * the same case differ only by the agent, never by the input". The live review
 * path (`reviews/run-executor.ts`) deliberately passes far more; copying it here
 * would silently make yesterday's run incomparable with today's because the
 * index moved underneath.
 *
 * ## Grounding is not re-run
 *
 * `reviewPullRequest` already applies the citation gate and hands back both the
 * survivors (`outcome.review.findings`) and `outcome.dropped`. `citation_accuracy`
 * is those two numbers; `groundFindings()` is never called a second time, and
 * scoring runs over the POST-grounding set (BQ-6a).
 *
 * ## Untrusted input
 *
 * `input_diff` is attacker-controlled PR content, STORED and replayed into a
 * model prompt on every future run — strictly worse than the live path, which
 * sees it once. It reaches the model only through `reviewPullRequest` →
 * `assemblePrompt`, which wraps the diff in `wrapUntrusted()` unconditionally
 * (`reviewer-core/src/prompt.ts:141`). Nothing in this module assembles a prompt
 * by hand, and `verify:l06` checks that statically.
 */

/**
 * REC-5's cap. A run is N sequential model calls, so the ceiling is a cost and
 * latency bound, not a storage one — the route's rate limit does the rest.
 */
export const MAX_CASES_PER_RUN = 50;

/** How many run rows the dashboards return under `recent_runs`. */
export const RECENT_RUNS_LIMIT = 25;

/** Longest generated case name; `eval_cases.name` is `text`, this is for the UI. */
const MAX_CASE_NAME = 160;

/**
 * REC-2 / spec open question 2. Emitted verbatim when nothing the agent produced
 * landed on a labelled line, so `precision` is 1 by the `TP + FP = 0` rule
 * rather than by merit. The client renders "n/a" instead of a flattering 100%.
 */
export const PRECISION_UNDEFINED_ALERT =
  'Precision is not meaningful for this run: no produced finding landed on a labelled line (TP + FP = 0).';

/** Minimal pino-compatible sink, so the service never depends on Fastify. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

const ZERO_CURRENT = {
  recall: 0,
  precision: 0,
  citation_accuracy: 0,
  traces_passed: 0,
  traces_total: 0,
  cost_usd: null,
} as const;

const ZERO_DELTA = { recall: 0, precision: 0, citation_accuracy: 0 } as const;

/** A batch summary widened with the agent it belongs to (workspace dashboard). */
export interface AgentEvalSummary {
  agent_id: string;
  agent_name: string;
  cases_total: number;
  current: EvalDashboard['current'];
  delta: EvalDashboard['delta'];
  last_ran_at: string | null;
}

/**
 * The workspace dashboard. `agents` is ADDITIVE to the given `EvalDashboard`
 * contract (which carries no per-agent breakdown at all) and exists because
 * AC-17 asks the page to list "every agent with its latest metrics" — without
 * it that table is one HTTP request per agent. Nothing validates responses on
 * the way out, so the extra key is free and the shape still satisfies
 * `EvalDashboard`.
 */
export type WorkspaceEvalDashboard = EvalDashboard & { agents: AgentEvalSummary[] };

export class EvalsService {
  private readonly repo: EvalsRepository;

  constructor(private readonly container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  // =========================================================================
  // Cases
  // =========================================================================

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.repo.listCases(workspaceId, agentId);
    return rows.map(toEvalCase);
  }

  /**
   * AC-1/AC-2/AC-4/AC-5 — turn one finding into a case.
   *
   * `expected_output` is derived HERE, from the server's own finding row, and is
   * never accepted from the client: the request body carries an owner hint and
   * nothing else (contract.ts `CreateEvalCaseBody`). A client that could post an
   * expectation could make any agent pass any case.
   */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    agentIdFromBody?: string,
  ): Promise<{ evalCase: EvalCase; created: boolean }> {
    const ctx = await this.repo.findingContext(workspaceId, findingId);
    // Missing and cross-workspace are the SAME answer on purpose (404, not 403).
    if (!ctx) throw new NotFoundError('Finding not found');
    const { finding, reviewAgentId, pull } = ctx;

    // AC-5 first: re-posting is idempotent regardless of what has happened to
    // the finding since (it may even have been re-labelled).
    const existing = await this.repo.findCaseByFinding(workspaceId, findingId);
    if (existing) return { evalCase: toEvalCase(existing), created: false };

    // AC-3's server half. An unlabelled finding is not a data point, and the
    // 422 says which finding and why rather than inventing a default kind.
    const decision = finding.acceptedAt ? 'accepted' : finding.dismissedAt ? 'dismissed' : null;
    if (!decision) {
      throw new ValidationError(
        `Finding "${finding.title}" has neither been accepted nor dismissed, so there is nothing to assert about it. Accept it (the agent must keep finding it) or dismiss it (the agent must stop) first.`,
      );
    }

    const ownerId = await this.resolveOwnerAgent(workspaceId, reviewAgentId, agentIdFromBody);

    // BQ-3a / REC-3 — the case's input is the ONE FILE the finding is on, sliced
    // out of the PR's reconstructed diff by the engine's own `sliceDiff`.
    // Keeping a run at N small calls is half the reason; the other half is that
    // a whole-PR input would let a finding on an unrelated file count as noise
    // against every case.
    const diff = await diffFromPrFiles(this.container.reviewRepo, pull.id);
    if (!diff.files.some((f) => f.path === finding.file)) {
      // `sliceDiff` falls back to the WHOLE diff when the path is absent
      // (`reviewer-core/src/review/reduce.ts:70`), which would quietly store
      // another file's content as this case's input. AC-4 wants the diff the
      // finding was made against; if the PR carries no patch for that file
      // there is none, and an unreplayable case is worse than a refusal.
      throw new ValidationError(
        `No stored diff covers ${finding.file} on PR #${pull.number}, so this finding cannot be replayed as an eval case.`,
      );
    }
    const inputDiff = sliceDiff(diff, finding.file);

    // `findings.severity` / `.category` are plain `text` columns, so they are
    // PARSED rather than cast: a row written before an enum value existed must
    // become a case with that field omitted, not a case carrying a value the
    // contract cannot re-read (Edge-3 — the expectation outlives its finding).
    const severity = Severity.safeParse(finding.severity);
    const category = FindingCategory.safeParse(finding.category);

    const expectation: EvalExpectation =
      decision === 'accepted'
        ? {
            kind: 'must_find',
            file: finding.file,
            start_line: finding.startLine,
            end_line: finding.endLine,
            severity: severity.success ? severity.data : null,
            category: category.success ? category.data : null,
            title: finding.title,
          }
        : {
            // AC-2: file + range ONLY. A dismissal says "nothing worth reporting
            // lives here", not "nothing of this severity".
            kind: 'must_not_flag',
            file: finding.file,
            start_line: finding.startLine,
            end_line: finding.endLine,
          };

    const row = await this.repo.insertCase({
      workspaceId,
      ownerId,
      name: caseName(finding.file, finding.startLine, finding.endLine, finding.title),
      inputDiff,
      inputFiles: [finding.file],
      inputMeta: {
        // The idempotency key (`findCaseByFinding` reads exactly this path).
        finding_id: finding.id,
        review_id: finding.reviewId,
        pr_id: pull.id,
        pr_number: pull.number,
        decision,
        source: 'finding',
      },
      expectedOutput: { expectations: [expectation] } satisfies ExpectedOutput,
      notes: null,
    });
    return { evalCase: toEvalCase(row), created: true };
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteCase(workspaceId, id);
    if (!deleted) throw new NotFoundError('Eval case not found');
  }

  // =========================================================================
  // Running
  // =========================================================================

  /**
   * Run one agent over its whole case set, synchronously (BQ-5a).
   *
   * Rows are written **as each case completes**, never batched at the end. That
   * is what makes an interrupted run survivable (Edge-7, cross-review CR-5): a
   * 50-case run can outlive the ~60s at which a browser or reverse proxy cuts
   * the connection, and when it does the rows already written stay put and the
   * batch reads as PARTIAL — `traces_total` below the case count — on
   * `GET /agents/:id/eval-runs`. A client that lost its connection recovers by
   * reading that list, which is why the batch list exists as a route.
   */
  async runSet(workspaceId: string, agentId: string, logger?: Logger): Promise<EvalRunResult[]> {
    const agent = await this.requireAgent(workspaceId, agentId);

    const allCases = await this.repo.listCases(workspaceId, agentId);
    // Edge-1 — a 422 naming the agent, not a run with NaN metrics.
    if (allCases.length === 0) {
      throw new ValidationError(
        `Agent "${agent.name}" has no eval cases yet. Turn an accepted or dismissed finding into a case first.`,
      );
    }
    const cases = allCases.slice(0, MAX_CASES_PER_RUN);
    if (allCases.length > cases.length) {
      logger?.warn(
        { agentId, cases: allCases.length, cap: MAX_CASES_PER_RUN },
        'evals: case set exceeds the per-run cap — running the first slice only',
      );
    }

    const llm = await this.container.llm(agent.provider as Provider);

    // REC-6 — the snapshot records WHAT each linked skill said, by hash, not
    // just that it was linked. Two runs a week apart can otherwise show an
    // identical snapshot and still differ because a body changed underneath.
    const skills = await this.repo.agentSkillsForSnapshot(agentId);
    const snapshot: EvalAgentSnapshot = {
      id: agent.id,
      name: agent.name,
      system_prompt: agent.systemPrompt,
      model: agent.model,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        version: s.version,
        content_hash: sha256(s.body),
      })),
    };
    const skillBodies = skills.map((s) => s.body);

    // One id and one clock reading for the WHOLE batch (AC-8). `ranAt` is
    // written explicitly rather than left to the column default so every row of
    // a batch shares a timestamp exactly, which is what the batch aggregate
    // orders on.
    const batchId = randomUUID();
    const ranAt = new Date();

    const partials: {
      runId: string;
      caseId: string;
      recall: number;
      precision: number;
      citationAccuracy: number;
      pass: boolean;
      durationMs: number;
      costUsd: number | null;
      caseName: string;
      expected: unknown;
      actual: unknown;
    }[] = [];

    for (const c of cases) {
      try {
        const parsed = ExpectedOutput.safeParse(c.expectedOutput);
        if (!parsed.success) {
          // Written by this server from its own finding row, so a parse failure
          // means the stored row is corrupt. Skip it rather than scoring an
          // empty expectation set, which would silently read as a pass.
          logger?.warn(
            { caseId: c.id, batchId },
            'evals: case has an unreadable expected_output — skipped',
          );
          continue;
        }
        const expectations = parsed.data.expectations;

        const started = Date.now();
        // ---- THE ENGINE CALL. Exactly five keys (AC-6/AC-7). ---------------
        const outcome = await reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff: parseUnifiedDiff(c.inputDiff ?? ''),
          llm,
          skills: skillBodies,
        });
        const durationMs = Date.now() - started;

        const kept = outcome.review.findings;
        const dropped = outcome.dropped.map((d) => d.finding);
        const scored = score({
          expectations,
          findings: kept,
          keptCount: kept.length,
          droppedCount: dropped.length,
        });

        const actualOutput: ActualOutput = {
          batch_id: batchId,
          // Pre-grounding, as produced: survivors first, then the dropped ones.
          // Storing only the survivors would make `citation_accuracy`
          // unreconstructable from the row.
          findings: [...kept, ...dropped],
          grounded_ids: kept.map((f) => f.id),
          matches: scored.matches,
          agent: snapshot,
        };

        const row = await this.repo.insertRun({
          caseId: c.id,
          ranAt,
          actualOutput,
          pass: scored.pass,
          recall: scored.recall,
          precision: scored.precision,
          citationAccuracy: scored.citation_accuracy,
          durationMs,
          // Read from the outcome, NEVER recomputed from token counts.
          costUsd: outcome.costUsd,
        });

        partials.push({
          runId: row.id,
          caseId: c.id,
          recall: scored.recall,
          precision: scored.precision,
          citationAccuracy: scored.citation_accuracy,
          pass: scored.pass,
          durationMs,
          costUsd: outcome.costUsd,
          caseName: c.name,
          expected: c.expectedOutput,
          actual: actualOutput,
        });
      } catch (err) {
        // Edge-7 / CR-5: stop, but leave what was written. The batch is now
        // recoverable and legible — `GET /agents/:id/eval-runs` shows it with
        // `traces_total` below the case count, and the error names the batch so
        // a client that never saw a response knows what to look for.
        logger?.error(
          {
            batchId,
            agentId,
            caseId: c.id,
            written: partials.length,
            total: cases.length,
            err: (err as Error).message,
          },
          'evals: run failed mid-batch — earlier rows kept, batch is partial',
        );
        throw new AppError(
          'eval_run_failed',
          `Eval run failed on case "${c.name}" after ${partials.length} of ${cases.length} case(s): ${(err as Error).message}. The completed rows were kept — see the batch in the run history.`,
          500,
          { batch_id: batchId, traces_written: partials.length, traces_total: cases.length },
        );
      }
    }

    // BQ-4a — the batch is the unit, so `traces_*` are batch-level counts and
    // ride on every row of the batch. The per-row metrics stay per-case.
    const tracesTotal = partials.length;
    const tracesPassed = partials.filter((p) => p.pass).length;

    logger?.info(
      { batchId, agentId, traces: tracesTotal, passed: tracesPassed },
      `evals: batch ${batchId} finished — ${tracesPassed}/${tracesTotal} case(s) passed`,
    );

    return partials.map((p) => ({
      run_id: p.runId,
      case_id: p.caseId,
      result: {
        recall: p.recall,
        precision: p.precision,
        citation_accuracy: p.citationAccuracy,
        traces_passed: tracesPassed,
        traces_total: tracesTotal,
        duration_ms: p.durationMs,
        cost_usd: p.costUsd,
        per_trace: [
          { name: p.caseName, pass: p.pass, expected: p.expected, actual: p.actual },
        ],
      },
    }));
  }

  // =========================================================================
  // Reading: batches + dashboards
  // =========================================================================

  /** The batch list (BQ-4a) — what Compare selects two of. */
  async listBatches(workspaceId: string, agentId: string): Promise<EvalBatchSummary[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.repo.listBatches(workspaceId, agentId);
    return rows.map(toBatchSummary);
  }

  async dashboardForAgent(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    await this.requireAgent(workspaceId, agentId);
    const [cases, batchRows, recent] = await Promise.all([
      this.repo.listCases(workspaceId, agentId),
      this.repo.listBatches(workspaceId, agentId),
      this.repo.recentRuns(workspaceId, { agentId, limit: RECENT_RUNS_LIMIT }),
    ]);
    const batches = batchRows.map(toBatchSummary);
    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: cases.length,
      ...this.aggregate(batches),
      recent_runs: recent.map(toRunRecord),
      alert: await this.alertFor(workspaceId, batches[0]),
    };
  }

  async dashboardForWorkspace(workspaceId: string): Promise<WorkspaceEvalDashboard> {
    const [casesTotal, byAgent, agents, batchRows, recent] = await Promise.all([
      this.repo.countCases(workspaceId),
      this.repo.countCasesByAgent(workspaceId),
      this.repo.agentsWithCases(workspaceId),
      this.repo.listBatches(workspaceId),
      this.repo.recentRuns(workspaceId, { limit: RECENT_RUNS_LIMIT }),
    ]);
    const batches = batchRows.map(toBatchSummary);

    // Per-agent rows come out of the SAME batch list, grouped in JS — a batch
    // never spans two agents, so this needs no extra query per agent.
    const perAgent: AgentEvalSummary[] = agents.map((a) => {
      const own = batchRows
        .filter((b) => b.ownerId === a.id)
        .map(toBatchSummary);
      const { current, delta } = this.aggregate(own);
      return {
        agent_id: a.id,
        agent_name: a.name,
        cases_total: byAgent.find((c) => c.ownerId === a.id)?.n ?? 0,
        current,
        delta,
        last_ran_at: own[0]?.ran_at ?? null,
      };
    });

    return {
      owner_kind: null,
      owner_id: null,
      cases_total: casesTotal,
      ...this.aggregate(batches),
      recent_runs: recent.map(toRunRecord),
      alert: await this.alertFor(workspaceId, batches[0]),
      agents: perAgent,
    };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  /** `current` + `delta` + `trend`, from a newest-first batch list. */
  private aggregate(batches: EvalBatchSummary[]): Pick<EvalDashboard, 'current' | 'delta' | 'trend'> {
    const latest = batches[0];
    const previous = batches[1];
    const trend: EvalTrendPoint[] = [...batches].reverse().map((b) => ({
      ran_at: b.ran_at,
      recall: b.recall,
      precision: b.precision,
      citation_accuracy: b.citation_accuracy,
      pass_rate: b.traces_total === 0 ? 0 : b.traces_passed / b.traces_total,
      cost_usd: b.cost_usd,
    }));
    return {
      current: latest
        ? {
            recall: latest.recall,
            precision: latest.precision,
            citation_accuracy: latest.citation_accuracy,
            traces_passed: latest.traces_passed,
            traces_total: latest.traces_total,
            cost_usd: latest.cost_usd,
          }
        : { ...ZERO_CURRENT },
      delta:
        latest && previous
          ? {
              recall: latest.recall - previous.recall,
              precision: latest.precision - previous.precision,
              citation_accuracy: latest.citation_accuracy - previous.citation_accuracy,
            }
          : { ...ZERO_DELTA },
      trend,
    };
  }

  /**
   * REC-2's alert, computed rather than guessed: re-label the latest batch's
   * GROUNDED findings against their cases' expectations and see whether any of
   * them landed on a labelled line. Deterministic, model-free, and it uses the
   * same pure `classifyFindings` the scorer does — `precision === 1` alone
   * cannot tell a real perfect score from a vacuous one.
   */
  private async alertFor(
    workspaceId: string,
    latest: EvalBatchSummary | undefined,
  ): Promise<string | null> {
    if (!latest) return null;
    const rows = await this.repo.runsForBatch(workspaceId, latest.batch_id);
    let labelled = 0;
    for (const r of rows) {
      const expected = ExpectedOutput.safeParse(r.expectedOutput);
      const envelope = ActualOutput.safeParse(r.run.actualOutput);
      if (!expected.success || !envelope.success) continue;
      const grounded = new Set(envelope.data.grounded_ids);
      const kept = envelope.data.findings.filter((f) => grounded.has(f.id));
      labelled += classifyFindings(expected.data.expectations, kept).filter(
        (l) => l !== 'ignored',
      ).length;
    }
    return labelled === 0 ? PRECISION_UNDEFINED_ALERT : null;
  }

  /** 404 for both "no such agent" and "not your agent" (never 403). */
  private async requireAgent(workspaceId: string, agentId: string) {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /**
   * BQ-2a's three-way owner resolution, in order: the review's own agent, then
   * the body's `agent_id`, then a 422 that says which of the two was missing.
   *
   * `reviews.agent_id` has no foreign key (`db/schema/reviews.ts:18`), so a
   * review can point at an agent that has since been deleted — hence the
   * existence check before it is used, and the fall-through to the body rather
   * than a 404 on a field the client never sent.
   */
  private async resolveOwnerAgent(
    workspaceId: string,
    reviewAgentId: string | null,
    fromBody: string | undefined,
  ): Promise<string> {
    for (const candidate of [reviewAgentId, fromBody]) {
      if (!candidate) continue;
      const agent = await this.container.agentsRepo.getById(workspaceId, candidate);
      if (agent) return agent.id;
    }
    throw new ValidationError(
      fromBody
        ? `Agent ${fromBody} does not exist in this workspace, and the review this finding came from is not attributed to an agent either. An eval case must be owned by an agent.`
        : 'The review this finding came from is not attributed to an agent, so the case has no owner. Send an `agent_id` in the request body to choose one.',
    );
  }
}

// ===========================================================================
// Row → contract mapping
// ===========================================================================

function caseName(file: string, start: number, end: number, title: string): string {
  const name = `${file}:${start}-${end} — ${title}`;
  return name.length > MAX_CASE_NAME ? `${name.slice(0, MAX_CASE_NAME - 1)}…` : name;
}

function sha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** `input_diff` is NOT NULL in the contract but nullable in the column. */
function toEvalCase(row: {
  id: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff: string | null;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
}): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

/** Timestamps cross the wire as ISO strings; postgres-js hands back `Date`. */
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toBatchSummary(row: BatchAggregateRow): EvalBatchSummary {
  const agent = EvalBatchSummary.shape.agent.safeParse(row.agent);
  return {
    batch_id: row.batchId,
    ran_at: iso(row.ranAt),
    recall: clamp01(row.recall),
    precision: clamp01(row.precision),
    citation_accuracy: clamp01(row.citationAccuracy),
    traces_passed: row.tracesPassed,
    traces_total: row.tracesTotal,
    cost_usd: row.costUsd ?? null,
    // A row whose envelope carries no snapshot yields null, and the compare
    // modal must say "snapshot unavailable" rather than render a blank diff —
    // a blank diff reads as "the prompts are identical".
    agent: agent.success ? agent.data : null,
  };
}

/** `avg()` can return 0.9999999999999999; the contract bounds these to [0,1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * `agent_id` / `agent_name` are ADDITIVE to `EvalRunRecord`, which has no agent
 * field (REC-1's original problem). The dashboard's cross-agent run table needs
 * attribution; the snapshot inside `actual_output` is the primary source and
 * these are the fallback for a row that has none.
 */
function toRunRecord(row: RunWithCaseRow): EvalRunRecord & {
  agent_id: string;
  agent_name: string | null;
} {
  return {
    id: row.run.id,
    case_id: row.run.caseId,
    case_name: row.caseName,
    ran_at: iso(row.run.ranAt),
    actual_output: row.run.actualOutput,
    pass: row.run.pass,
    recall: row.run.recall,
    precision: row.run.precision,
    citation_accuracy: row.run.citationAccuracy,
    duration_ms: row.run.durationMs,
    cost_usd: row.run.costUsd,
    agent_id: row.ownerId,
    agent_name: row.agentName,
  };
}
