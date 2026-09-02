import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { EvalCase, EvalDashboard, EvalRunResult, Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { ActualOutput, ExpectedOutput, type EvalBatchSummary } from '../src/modules/evals/contract.js';

/**
 * L06 S6 — the eval pipeline against a real Postgres.
 *
 * The fixture LABELS ITS OWN FINDINGS rather than depending on what the seed
 * happens to contain, so this file stays green independently of S12's dataset
 * work: it creates its own repo, PR, patch, review and three findings, and
 * decides which are accepted, dismissed and unlabelled.
 *
 * The PR carries ONE file whose hunk covers new-side lines 10–13. That is what
 * makes the grounding gate's behaviour predictable here: a finding on line 11
 * or 12 survives it, and anything else does not.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** HUNKS ONLY — `diffFromPrFiles` re-adds the `diff --git`/`---`/`+++` header. */
const PATCH = [
  '@@ -10,2 +10,4 @@',
  ' const a = 1;',
  '+const token = "hardcoded";',
  '+export const b = 2;',
  ' const c = 3;',
].join('\n');

const FILE = 'src/config.ts';

/**
 * What the mock agent "produces" on every case: one finding on line 11 (which
 * an accepted finding asked for) and one on line 12 (which a dismissed finding
 * asked it to stop reporting). Both ground.
 */
const MODEL_OUTPUT: Review = {
  verdict: 'comment',
  summary: 'Two findings.',
  score: 70,
  findings: [
    {
      id: 'm-hit',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded token',
      file: FILE,
      start_line: 11,
      end_line: 11,
      explanation: 'A secret is committed.',
      confidence: 0.9,
    },
    {
      id: 'm-noise',
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Prefer const assertions',
      file: FILE,
      start_line: 12,
      end_line: 12,
      explanation: 'Style.',
      confidence: 0.4,
    },
  ],
};

d('L06 eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;
  let agentId: string;
  let accepted: string;
  let dismissed: string;
  let unlabelled: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: ws } = await seed(pg.handle.db);
    workspaceId = ws;

    llm = new MockLLMProvider('openai', { structured: MODEL_OUTPUT });
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm } },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Eval Reviewer',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'Find hardcoded secrets.',
        },
      })
    ).json() as { id: string };
    agentId = agent.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'evals-it', fullName: 'acme/evals-it' })
      .returning();
    const [pull] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900,
        title: 'Add config',
        author: 'dev',
        branch: 'feat/config',
        base: 'main',
        headSha: 'abc123',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values([
        { prId: pull!.id, path: FILE, additions: 2, deletions: 0, patch: PATCH },
        // A second changed file with NO patch — `diffFromPrFiles` skips it, and
        // a case built on it would be unreplayable.
        { prId: pull!.id, path: 'README.md', additions: 1, deletions: 0, patch: null },
      ]);

    // The review is attributed to the agent, so BQ-2a's FIRST owner branch is
    // the one exercised here (no `agent_id` in any request body below).
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pull!.id,
        agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 'r',
        score: 70,
        model: 'gpt-4.1',
      })
      .returning();

    const rows = await pg.handle.db
      .insert(t.findings)
      .values([
        {
          reviewId: review!.id,
          file: FILE,
          startLine: 11,
          endLine: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded token',
          rationale: 'A secret is committed.',
          confidence: 0.9,
          acceptedAt: new Date(),
        },
        {
          reviewId: review!.id,
          file: FILE,
          startLine: 12,
          endLine: 12,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Prefer const assertions',
          rationale: 'Style nit.',
          confidence: 0.4,
          dismissedAt: new Date(),
        },
        {
          reviewId: review!.id,
          file: FILE,
          startLine: 13,
          endLine: 13,
          severity: 'WARNING',
          category: 'bug',
          title: 'Unreviewed',
          rationale: 'Nobody decided.',
          confidence: 0.5,
        },
      ])
      .returning();
    accepted = rows[0]!.id;
    dismissed = rows[1]!.id;
    unlabelled = rows[2]!.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const createCase = (findingId: string) =>
    app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

  it('AC-1 — an accepted finding becomes a must_find carrying file, lines, severity and category', async () => {
    const res = await createCase(accepted);
    expect(res.statusCode).toBe(201);
    const body = res.json() as EvalCase;
    expect(body.owner_kind).toBe('agent');
    // BQ-2a's first branch: the owner came from `review.agent_id`, with no body.
    expect(body.owner_id).toBe(agentId);

    const expected = ExpectedOutput.parse(body.expected_output);
    expect(expected.expectations).toEqual([
      {
        kind: 'must_find',
        file: FILE,
        start_line: 11,
        end_line: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded token',
      },
    ]);
  });

  it('AC-2 — a dismissed finding becomes a must_not_flag with file and range only', async () => {
    const res = await createCase(dismissed);
    expect(res.statusCode).toBe(201);
    const expected = ExpectedOutput.parse((res.json() as EvalCase).expected_output);
    expect(expected.expectations).toEqual([
      { kind: 'must_not_flag', file: FILE, start_line: 12, end_line: 12 },
    ]);
    // A dismissal makes no claim about severity — carrying one would invite a
    // match rule that only counts a false positive when severities agree.
    expect(expected.expectations[0]).not.toHaveProperty('severity');
  });

  it('AC-3 — an unlabelled finding is a 422 that says why', async () => {
    const res = await createCase(unlabelled);
    expect(res.statusCode).toBe(422);
    const err = res.json().error;
    expect(err.code).toBe('validation_error');
    expect(err.message).toMatch(/neither been accepted nor dismissed/i);
  });

  it('AC-4 — input_diff is the single file’s slice, non-empty and replayable', async () => {
    const cases = (await app.inject({ url: `/agents/${agentId}/eval-cases` })).json() as EvalCase[];
    const one = cases[0]!;
    expect(one.input_diff.length).toBeGreaterThan(0);
    expect(one.input_diff).toContain(`diff --git a/${FILE} b/${FILE}`);
    expect(one.input_diff).toContain('+const token = "hardcoded";');
    // The SLICE, not the PR: the second changed file must not be in there.
    expect(one.input_diff).not.toContain('README.md');
    expect(one.input_files).toEqual([FILE]);
  });

  it('AC-5 — re-posting returns the existing case, never a duplicate', async () => {
    const first = (await createCase(accepted)).json() as EvalCase;
    const second = await createCase(accepted);
    expect(second.statusCode).toBe(200); // 200, not 201 — nothing was created
    expect((second.json() as EvalCase).id).toBe(first.id);

    const cases = (await app.inject({ url: `/agents/${agentId}/eval-cases` })).json() as EvalCase[];
    expect(cases).toHaveLength(2);
  });

  it('AC-8/AC-9/AC-10 — a run writes one row per case, one batch_id, and makes exactly N model calls', async () => {
    const before = llm.calls.length;
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const results = res.json() as EvalRunResult[];

    expect(results).toHaveLength(2);
    // AC-10 — scoring adds ZERO model calls: N cases, N calls, nothing else.
    expect(llm.calls.length - before).toBe(2);

    const rows = await pg.handle.db.select().from(t.evalRuns);
    expect(rows).toHaveLength(2);
    const batchIds = new Set(
      rows.map((r) => ActualOutput.parse(r.actualOutput).batch_id),
    );
    expect(batchIds.size).toBe(1);
    expect(new Set(rows.map((r) => r.ranAt.getTime())).size).toBe(1);

    // Three metrics on every row, and never null.
    for (const row of rows) {
      expect(row.recall).not.toBeNull();
      expect(row.precision).not.toBeNull();
      expect(row.citationAccuracy).not.toBeNull();
      expect(row.citationAccuracy).toBe(1); // both produced findings ground
    }

    // AC-9 — the envelope, including the agent snapshot (REC-1 / REC-6).
    const envelope = ActualOutput.parse(rows[0]!.actualOutput);
    expect(envelope.agent.id).toBe(agentId);
    expect(envelope.agent.name).toBe('Eval Reviewer');
    expect(envelope.agent.system_prompt).toBe('Find hardcoded secrets.');
    expect(envelope.grounded_ids.sort()).toEqual(['m-hit', 'm-noise']);

    // Pass semantics: the must_find case passes, the must_not_flag case does
    // not — the agent reported exactly the finding a reviewer dismissed.
    const passes = rows.filter((r) => r.pass === true);
    const fails = rows.filter((r) => r.pass === false);
    expect(passes).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]!.precision).toBe(0);

    // BQ-4a — batch-level trace counts ride on every returned row.
    for (const r of results) {
      expect(r.result.traces_total).toBe(2);
      expect(r.result.traces_passed).toBe(1);
    }
  });

  it('the batch list reports the batch as a unit', async () => {
    const batches = (
      await app.inject({ url: `/agents/${agentId}/eval-runs` })
    ).json() as EvalBatchSummary[];
    expect(batches).toHaveLength(1);
    expect(batches[0]!.traces_total).toBe(2);
    expect(batches[0]!.traces_passed).toBe(1);
    expect(batches[0]!.agent?.name).toBe('Eval Reviewer');
    expect(batches[0]!.recall).toBeGreaterThanOrEqual(0);
    expect(new Date(batches[0]!.ran_at).toString()).not.toBe('Invalid Date');
  });

  it('the dashboards read the stored rows', async () => {
    const agentDash = (
      await app.inject({ url: `/agents/${agentId}/eval-dashboard` })
    ).json() as EvalDashboard;
    expect(agentDash.owner_kind).toBe('agent');
    expect(agentDash.owner_id).toBe(agentId);
    expect(agentDash.cases_total).toBe(2);
    expect(agentDash.current.traces_total).toBe(2);
    expect(agentDash.trend).toHaveLength(1);
    expect(agentDash.recent_runs).toHaveLength(2);
    // One run landed on a labelled line, so precision IS meaningful here.
    expect(agentDash.alert).toBeNull();

    const wsDash = (await app.inject({ url: '/eval-dashboard' })).json() as EvalDashboard & {
      agents: { agent_id: string; agent_name: string; cases_total: number }[];
    };
    expect(wsDash.owner_kind).toBeNull();
    expect(wsDash.cases_total).toBeGreaterThanOrEqual(2);
    expect(wsDash.agents.some((a) => a.agent_id === agentId && a.cases_total === 2)).toBe(true);
    // REC-1 — a cross-agent run table can name its agent.
    const mine = wsDash.recent_runs.find((r) => r.case_id);
    expect(ActualOutput.parse(mine!.actual_output).agent.name).toBe('Eval Reviewer');
  });

  it('Edge-3 — deleting the source finding leaves the case intact and listable', async () => {
    await pg.handle.db.delete(t.findings).where(eq(t.findings.id, accepted));

    const cases = (await app.inject({ url: `/agents/${agentId}/eval-cases` })).json() as EvalCase[];
    expect(cases).toHaveLength(2);
    const orphan = cases.find(
      (c) => (c.input_meta as { finding_id: string }).finding_id === accepted,
    );
    expect(orphan).toBeDefined();
    // It still carries everything a replay needs — it never dereferences the
    // finding again.
    expect(orphan!.input_diff.length).toBeGreaterThan(0);
    expect(ExpectedOutput.parse(orphan!.expected_output).expectations).toHaveLength(1);
  });

  it('DELETE removes a case, and a second delete is a 404', async () => {
    const cases = (await app.inject({ url: `/agents/${agentId}/eval-cases` })).json() as EvalCase[];
    const target = cases[0]!.id;
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${target}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${target}` })).statusCode).toBe(404);
  });

  it('Edge-1 — running an agent with no cases is a 422 naming it', async () => {
    const empty = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Idle Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
      })
    ).json() as { id: string };

    const before = llm.calls.length;
    const res = await app.inject({ method: 'POST', url: `/agents/${empty.id}/eval-runs` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('Idle Reviewer');
    expect(llm.calls.length).toBe(before);
  });

  it('a finding whose file carries no stored patch cannot become a case', async () => {
    const [review] = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.workspaceId, workspaceId))
      .limit(1);
    const [orphanFile] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'README.md',
        startLine: 1,
        endLine: 1,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'No patch here',
        rationale: 'The PR carries no patch for this file.',
        confidence: 0.5,
        acceptedAt: new Date(),
      })
      .returning();

    const res = await createCase(orphanFile!.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/README\.md/);
  });

  it('cross-workspace reads are a 404, never a 403', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: other!.id,
        name: 'Foreign',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'p',
      })
      .returning();

    for (const url of [
      `/agents/${foreign!.id}/eval-cases`,
      `/agents/${foreign!.id}/eval-dashboard`,
      `/agents/${foreign!.id}/eval-runs`,
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
  });
});
