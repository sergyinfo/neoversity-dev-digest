import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import { ActualOutput, ExpectedOutput } from '../src/modules/evals/contract.js';

/**
 * L06 S12 — the SEEDED DATASET, against a real Postgres.
 *
 * This file is the counterpart to `evals.it.test.ts`, which deliberately labels
 * its own findings so it stays green independently of the seed. Here the seed
 * IS the subject: the whole eval feature measures a labelled dataset, and
 * before L06 the demo data could not produce a single case — of PR #482's four
 * `pr_files` only `src/config.ts` carried a `patch` (and `diffFromPrFiles`
 * skips patch-less files), and not one of the ten findings carried
 * `accepted_at` or `dismissed_at`.
 *
 * The load-bearing assertion is the OVERLAP one. A finding whose lines fall
 * outside its file's hunks can neither match nor ground, and the failure is
 * quiet in both directions: `sliceDiff` returns the WHOLE diff for a path that
 * is absent (`reviewer-core/src/review/reduce.ts:70`) rather than an empty
 * string, and the grounding gate simply drops a citation it cannot place. The
 * arithmetic in the seed's hunk constants is therefore checked here rather than
 * trusted.
 *
 * Docker note (`server/INSIGHTS.md` 2026-08-20): under OrbStack these files
 * FAIL rather than skip unless `DOCKER_HOST` points at the OrbStack socket —
 * `export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Every table the seed writes to — the idempotency check counts all of them. */
const SEEDED_TABLES = [
  ['workspaces', t.workspaces],
  ['users', t.users],
  ['repos', t.repos],
  ['pull_requests', t.pullRequests],
  ['pr_files', t.prFiles],
  ['pr_commits', t.prCommits],
  ['reviews', t.reviews],
  ['findings', t.findings],
  ['agents', t.agents],
  ['agent_runs', t.agentRuns],
  ['run_traces', t.runTraces],
  ['context_attachments', t.contextAttachments],
  ['pr_brief', t.prBrief],
  ['eval_cases', t.evalCases],
  ['eval_runs', t.evalRuns],
] as const;

d('seed: the L06 labelled dataset', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const r = await seed(pg.handle.db);
    workspaceId = r.workspaceId;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  const seededPr = async () => {
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 482)));
    return pr!;
  };

  const labelledFindings = async () => {
    const rows = await pg.handle.db
      .select()
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.model, 'seed')));
    return rows
      .map((r) => r.findings)
      .filter((f) => f.acceptedAt !== null || f.dismissedAt !== null);
  };

  it('labels at least 8 findings, split across both decisions', async () => {
    const labelled = await labelledFindings();
    expect(labelled.length).toBeGreaterThanOrEqual(8);

    const accepted = labelled.filter((f) => f.acceptedAt !== null);
    const dismissed = labelled.filter((f) => f.dismissedAt !== null);
    // Both kinds must exist or one half of the score has nothing to bite on:
    // accepted findings feed `must_find` (recall), dismissed ones `must_not_flag`
    // (precision).
    expect(accepted.length).toBeGreaterThanOrEqual(5);
    expect(dismissed.length).toBeGreaterThanOrEqual(4);
    // No finding is both, which would make its expectation kind arbitrary.
    expect(labelled.filter((f) => f.acceptedAt && f.dismissedAt)).toHaveLength(0);
  });

  it('gives every labelled finding a hunk that OVERLAPS its line range', async () => {
    const pr = await seededPr();
    const diff = await diffFromPrFiles(new ReviewRepository(pg.handle.db), pr.id);
    const labelled = await labelledFindings();

    for (const f of labelled) {
      const file = diff.files.find((x) => x.path === f.file);
      // Absent file → `sliceDiff` would hand back the whole diff and the eval
      // service would refuse the case with a 422.
      expect(file, `no diff for ${f.file}`).toBeDefined();

      const covered = new Set(file!.hunks.flatMap((h) => h.newLineNumbers));
      const overlapping = [];
      for (let n = f.startLine; n <= f.endLine; n++) if (covered.has(n)) overlapping.push(n);
      expect(
        overlapping.length,
        `${f.file}:${f.startLine}-${f.endLine} ("${f.title}") is outside every hunk`,
      ).toBeGreaterThan(0);
    }
  });

  it('attributes the seeded review to the Security Reviewer agent', async () => {
    const [row] = await pg.handle.db
      .select({ agentId: t.reviews.agentId, agentName: t.agents.name })
      .from(t.reviews)
      .leftJoin(t.agents, eq(t.agents.id, t.reviews.agentId))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.model, 'seed')));
    // BQ-2a's first branch — `POST /findings/:id/eval-case` resolves the owner
    // from `reviews.agent_id` before it looks at the request body.
    expect(row!.agentId).not.toBeNull();
    expect(row!.agentName).toBe('Security Reviewer');
  });

  it('seeds at least 8 eval cases, all owned by that agent and all parseable', async () => {
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));

    const cases = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));

    expect(cases.length).toBeGreaterThanOrEqual(8);
    for (const c of cases) {
      expect(c.ownerKind).toBe('agent');
      expect(c.ownerId).toBe(agent!.id);
      const parsed = ExpectedOutput.safeParse(c.expectedOutput);
      expect(parsed.success, `unparseable expected_output on "${c.name}"`).toBe(true);
      expect(parsed.data!.expectations.length).toBeGreaterThan(0);
      // The case input is ONE file's slice, not the whole PR (BQ-3a).
      expect(c.inputDiff ?? '').toContain(parsed.data!.expectations[0]!.file);
    }
    // Both expectation kinds are represented.
    const kinds = new Set(
      cases.flatMap((c) => ExpectedOutput.parse(c.expectedOutput).expectations.map((e) => e.kind)),
    );
    expect([...kinds].sort()).toEqual(['must_find', 'must_not_flag']);
  });

  it('seeds exactly two batches, with different prompts and different metrics', async () => {
    const runs = await pg.handle.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.workspaceId, workspaceId));

    const envelopes = runs.map((r) => ActualOutput.parse(r.run.actualOutput));
    const batchIds = [...new Set(envelopes.map((e) => e.batch_id))];
    expect(batchIds).toHaveLength(2);

    const byBatch = batchIds.map((id) => ({
      id,
      rows: runs.filter((r) => ActualOutput.parse(r.run.actualOutput).batch_id === id),
      prompt: envelopes.find((e) => e.batch_id === id)!.agent.system_prompt,
    }));

    // Every case ran in both batches, so Compare has a like-for-like diff.
    const caseCount = (
      await pg.handle.db
        .select()
        .from(t.evalCases)
        .where(eq(t.evalCases.workspaceId, workspaceId))
    ).length;
    for (const b of byBatch) expect(b.rows.length).toBe(caseCount);

    // The prompt snapshot is what the compare modal diffs — two identical ones
    // would render a blank diff, which reads as "nothing changed".
    expect(byBatch[0]!.prompt).not.toBe(byBatch[1]!.prompt);

    const avg = (rows: typeof runs, pick: (r: (typeof runs)[number]) => number | null) =>
      rows.reduce((s, r) => s + (pick(r) ?? 0), 0) / rows.length;
    const precisions = byBatch.map((b) => avg(b.rows, (r) => r.run.precision));
    const passed = byBatch.map((b) => b.rows.filter((r) => r.run.pass).length);
    // Visibly different, not merely different — the modal exists to show a move.
    expect(Math.abs(precisions[0]! - precisions[1]!)).toBeGreaterThan(0.2);
    expect(passed[0]).not.toBe(passed[1]);
  });

  it('is idempotent: a second seed() changes no row count', async () => {
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const [name, table] of SEEDED_TABLES) {
        const [row] = await pg.handle.db.select({ n: sql<number>`count(*)::int` }).from(table);
        out[name] = row!.n;
      }
      return out;
    };

    const before = await counts();
    await seed(pg.handle.db);
    const after = await counts();

    expect(after).toEqual(before);
    // Guard against a vacuous pass: the tables this step fills are non-empty.
    expect(before['eval_cases']).toBeGreaterThanOrEqual(8);
    expect(before['eval_runs']).toBe(before['eval_cases']! * 2);
  });
});
