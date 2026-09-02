import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Review } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { ActualOutput } from '../src/modules/evals/contract.js';
import type {
  BatchAggregateRow,
  InsertEvalRun,
  RunWithCaseRow,
} from '../src/modules/evals/repository.js';

/**
 * L06 S4 — the run loop's invariants, with no database and one mock model.
 *
 * The engine is spied on but NOT stubbed: `reviewPullRequest` runs for real
 * (assembly → mock completion → the citation-grounding gate), so the grounding
 * numbers these tests read are the engine's own. What the spy adds is the one
 * assertion that cannot be made any other way — the exact KEY SET the service
 * hands the engine (AC-6/AC-7).
 */

const spy = vi.hoisted(() => ({ inputs: [] as Record<string, unknown>[] }));

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return {
    ...actual,
    reviewPullRequest: (input: Record<string, unknown>) => {
      spy.inputs.push(input);
      return actual.reviewPullRequest(input as never);
    },
  };
});

const {
  EvalsService,
  MAX_CASES_PER_RUN,
  AGENT_RECENT_RUNS_LIMIT,
  RECENT_RUNS_LIMIT,
  PRECISION_UNDEFINED_ALERT,
} = await import('../src/modules/evals/service.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A one-file diff whose hunk covers new-side lines 10–13, so a finding on line
 * 11 SURVIVES the grounding gate and one on line 900 does not. Header lines are
 * present here because this is a stored `input_diff` (already sliced), not a
 * seeded `pr_files.patch`.
 */
const DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,2 +10,4 @@',
  ' const a = 1;',
  '+const token = "hardcoded";',
  '+export const b = 2;',
  ' const c = 3;',
].join('\n');

const review = (findings: Review['findings']): Review => ({
  verdict: 'comment',
  summary: 'ok',
  score: 80,
  findings,
});

const HIT = review([
  {
    id: 'f-hit',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded token',
    file: 'src/config.ts',
    start_line: 11,
    end_line: 11,
    explanation: 'no',
    confidence: 0.9,
  },
]);

function evalCase(id: string, name: string, expectations: unknown[]) {
  return {
    id,
    workspaceId: 'ws-1',
    ownerKind: 'agent' as const,
    ownerId: 'agent-1',
    name,
    inputDiff: DIFF,
    inputFiles: ['src/config.ts'],
    inputMeta: { finding_id: `src-${id}` },
    expectedOutput: { expectations },
    notes: null,
  };
}

const MUST_FIND = {
  kind: 'must_find',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded token',
};

interface BuildOpts {
  cases?: ReturnType<typeof evalCase>[];
  skills?: { id: string; name: string; version: number; body: string }[];
  structured?: unknown;
  /** Make `insertRun` throw on the Nth (1-based) call — Edge-7. */
  failInsertOn?: number;
  agent?: Record<string, unknown>;
}

function build(opts: BuildOpts = {}) {
  const llm = new MockLLMProvider('openai', { structured: opts.structured ?? HIT });
  const inserted: InsertEvalRun[] = [];
  let n = 0;

  const agent = {
    id: 'agent-1',
    name: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    ...opts.agent,
  };

  const container = {
    db: {} as never,
    agentsRepo: { getById: async () => agent },
    llm: async () => llm,
  } as never;

  const service = new EvalsService(container);
  const repo = {
    listCases: async () => opts.cases ?? [evalCase('c1', 'a.ts', [MUST_FIND])],
    agentSkillsForSnapshot: async () => opts.skills ?? [],
    insertRun: async (values: InsertEvalRun) => {
      n += 1;
      if (opts.failInsertOn === n) throw new Error('connection lost');
      inserted.push(values);
      return { id: `run-${n}`, ...values };
    },
  };
  (service as unknown as { repo: Record<string, unknown> }).repo = repo;

  return { service, llm, inserted, agent };
}

beforeEach(() => {
  spy.inputs.length = 0;
});

// ---------------------------------------------------------------------------

describe('runSet — what reaches the engine (AC-6 / AC-7)', () => {
  it('passes ONLY systemPrompt, model, diff, llm and skills', async () => {
    const { service } = build();
    await service.runSet('ws-1', 'agent-1');

    expect(spy.inputs).toHaveLength(1);
    expect(Object.keys(spy.inputs[0]!).sort()).toEqual([
      'diff',
      'llm',
      'model',
      'skills',
      'systemPrompt',
    ]);
    // The live review path passes all of these; an eval run must not, or two
    // runs a week apart would differ by the index rather than by the agent.
    for (const forbidden of [
      'callers',
      'repoMap',
      'specs',
      'intent',
      'prDescription',
      'task',
      'sessionId',
      'memory',
      'onEvent',
    ]) {
      expect(spy.inputs[0]).not.toHaveProperty(forbidden);
    }
  });

  it('replays the case’s stored diff, not anything read live', async () => {
    const { service } = build();
    await service.runSet('ws-1', 'agent-1');
    const diff = spy.inputs[0]!.diff as { raw: string; files: { path: string }[] };
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(diff.raw).toBe(DIFF);
  });
});

describe('runSet — the batch (AC-8 / BQ-4a)', () => {
  it('writes one row per case, all sharing one batch_id and one ran_at', async () => {
    const cases = [
      evalCase('c1', 'one', [MUST_FIND]),
      evalCase('c2', 'two', [MUST_FIND]),
      evalCase('c3', 'three', [MUST_FIND]),
    ];
    const { service, llm, inserted } = build({ cases });

    const results = await service.runSet('ws-1', 'agent-1');

    expect(inserted).toHaveLength(3);
    const batchIds = new Set(inserted.map((r) => (r.actualOutput as { batch_id: string }).batch_id));
    expect(batchIds.size).toBe(1);
    expect(new Set(inserted.map((r) => r.ranAt.getTime())).size).toBe(1);

    // AC-10: N cases, N model calls. Scoring adds ZERO.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(3);
    expect(llm.calls).toHaveLength(3);

    // Batch-level trace counts ride on every row of the batch.
    for (const r of results) {
      expect(r.result.traces_total).toBe(3);
      expect(r.result.traces_passed).toBe(3);
    }
  });

  it('caps a run at 50 cases (REC-5)', async () => {
    const cases = Array.from({ length: MAX_CASES_PER_RUN + 7 }, (_, i) =>
      evalCase(`c${i}`, `case ${i}`, [MUST_FIND]),
    );
    const { service, llm } = build({ cases });
    const results = await service.runSet('ws-1', 'agent-1');
    expect(results).toHaveLength(MAX_CASES_PER_RUN);
    expect(llm.calls).toHaveLength(MAX_CASES_PER_RUN);
  });
});

describe('runSet — scoring rides on the engine, never on a second gate', () => {
  it('scores the post-grounding set and takes citation_accuracy from kept vs dropped', async () => {
    // Two findings: one on a real hunk line, one on a line the diff never touches.
    const mixed = review([
      ...HIT.findings,
      {
        id: 'f-ghost',
        severity: 'WARNING',
        category: 'bug',
        title: 'Imagined',
        file: 'src/config.ts',
        start_line: 900,
        end_line: 901,
        explanation: 'no',
        confidence: 0.5,
      },
    ]);
    const { service, inserted } = build({ structured: mixed });

    const [result] = await service.runSet('ws-1', 'agent-1');

    expect(result!.result.citation_accuracy).toBe(0.5); // 1 kept of 2 produced
    expect(result!.result.recall).toBe(1); // the surviving one matches
    const envelope = ActualOutput.parse(inserted[0]!.actualOutput);
    // Both produced findings are stored; only the survivor is grounded.
    expect(envelope.findings.map((f) => f.id).sort()).toEqual(['f-ghost', 'f-hit']);
    expect(envelope.grounded_ids).toEqual(['f-hit']);
    expect(envelope.matches).toEqual([{ expectation_index: 0, finding_id: 'f-hit' }]);
  });
});

describe('runSet — the agent snapshot (REC-1 / REC-6)', () => {
  const skills = [{ id: 's1', name: 'OWASP', version: 3, body: 'never hardcode secrets' }];

  it('records id, name, prompt, model and a content hash per linked skill', async () => {
    const { service, inserted } = build({ skills });
    await service.runSet('ws-1', 'agent-1');

    const { agent } = ActualOutput.parse(inserted[0]!.actualOutput);
    expect(agent.id).toBe('agent-1');
    expect(agent.name).toBe('Security Reviewer');
    expect(agent.system_prompt).toBe('You are a reviewer.');
    expect(agent.model).toBe('gpt-4.1');
    expect(agent.skills).toEqual([
      { id: 's1', name: 'OWASP', version: 3, content_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    // There is no `slug` column on `skills`; the snapshot must not invent one.
    expect(agent.skills[0]).not.toHaveProperty('slug');
  });

  it('the hash is stable for the same body and moves when the body changes', async () => {
    const first = build({ skills });
    await first.service.runSet('ws-1', 'agent-1');
    const again = build({ skills });
    await again.service.runSet('ws-1', 'agent-1');
    const edited = build({ skills: [{ ...skills[0]!, body: 'never hardcode secrets, ever' }] });
    await edited.service.runSet('ws-1', 'agent-1');

    const hash = (r: { actualOutput: unknown }) =>
      ActualOutput.parse(r.actualOutput).agent.skills[0]!.content_hash;

    expect(hash(first.inserted[0]!)).toBe(hash(again.inserted[0]!));
    // The whole point of REC-6: same prompt, same skill id and name — different
    // content. Without the hash these two runs are indistinguishable.
    expect(hash(edited.inserted[0]!)).not.toBe(hash(first.inserted[0]!));
  });

  it('passes the skill BODIES to the engine, in configured order', async () => {
    const { service } = build({
      skills: [
        { id: 's1', name: 'A', version: 1, body: 'first' },
        { id: 's2', name: 'B', version: 1, body: 'second' },
      ],
    });
    await service.runSet('ws-1', 'agent-1');
    expect(spy.inputs[0]!.skills).toEqual(['first', 'second']);
  });
});

describe('runSet — failure modes', () => {
  it('an empty case set is a 422 naming the agent (Edge-1)', async () => {
    const { service, llm } = build({ cases: [] });
    await expect(service.runSet('ws-1', 'agent-1')).rejects.toMatchObject({
      code: 'validation_error',
      statusCode: 422,
      message: expect.stringContaining('Security Reviewer'),
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('a mid-batch failure keeps the earlier rows and reports a partial batch (Edge-7 / CR-5)', async () => {
    const cases = [
      evalCase('c1', 'one', [MUST_FIND]),
      evalCase('c2', 'two', [MUST_FIND]),
      evalCase('c3', 'three', [MUST_FIND]),
    ];
    const { service, inserted } = build({ cases, failInsertOn: 3 });

    const err = await service.runSet('ws-1', 'agent-1').catch((e: unknown) => e);

    expect(err).toMatchObject({
      code: 'eval_run_failed',
      details: { traces_written: 2, traces_total: 3 },
    });
    // The rows written before the failure SURVIVE — that is what makes the
    // batch recoverable from `GET /agents/:id/eval-runs` afterwards.
    expect(inserted).toHaveLength(2);
    const batchId = (inserted[0]!.actualOutput as { batch_id: string }).batch_id;
    expect((err as { details: { batch_id: string } }).details.batch_id).toBe(batchId);
    // ... and it is legible as PARTIAL: 2 rows written for a 3-case set.
    expect(inserted.every((r) => (r.actualOutput as { batch_id: string }).batch_id === batchId)).toBe(true);
  });

  it('skips a case whose stored expected_output is unreadable rather than scoring it as a pass', async () => {
    const cases = [
      { ...evalCase('c1', 'one', []), expectedOutput: { expectations: [{ kind: 'nonsense' }] } },
      evalCase('c2', 'two', [MUST_FIND]),
    ];
    const { service, inserted, llm } = build({ cases });
    const results = await service.runSet('ws-1', 'agent-1');

    expect(inserted).toHaveLength(1);
    expect(llm.calls).toHaveLength(1);
    expect(results[0]!.result.traces_total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Dashboards — fix brief F2 (recent-runs truncation) and F3 (per-agent REC-2)
// ---------------------------------------------------------------------------

const RAN_AT = new Date('2026-09-03T10:00:00.000Z');

/**
 * One run row as the repository returns it, carrying a real `actual_output`
 * envelope: `precisionUndefinedByBatch` re-parses these, so a hand-waved shape
 * would make every batch look unreadable and pass the test for the wrong reason.
 */
function runRow(over: {
  caseId: string;
  caseName: string;
  batchId: string;
  ownerId?: string;
  /** A finding on a labelled line — what makes TP + FP > 0. */
  landsOnLabelledLine: boolean;
}): RunWithCaseRow {
  const hit = {
    id: `f-${over.caseId}`,
    severity: 'CRITICAL' as const,
    category: 'security' as const,
    title: 'Hardcoded token',
    file: 'src/config.ts',
    // 11 overlaps the expectation below; 900 lands nowhere labelled.
    start_line: over.landsOnLabelledLine ? 11 : 900,
    end_line: over.landsOnLabelledLine ? 11 : 900,
    explanation: 'no',
    confidence: 0.9,
  };
  return {
    run: {
      id: `run-${over.caseId}`,
      caseId: over.caseId,
      ranAt: RAN_AT,
      actualOutput: {
        batch_id: over.batchId,
        findings: [hit],
        grounded_ids: [hit.id],
        matches: [],
        agent: { id: 'agent-1', name: 'Security Reviewer', system_prompt: 'p', model: 'm', skills: [] },
      },
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 10,
      costUsd: 0.001,
    },
    caseName: over.caseName,
    ownerId: over.ownerId ?? 'agent-1',
    agentName: 'Security Reviewer',
    expectedOutput: { expectations: [MUST_FIND] },
  };
}

function batchRow(over: Partial<BatchAggregateRow> & { batchId: string }): BatchAggregateRow {
  return {
    ownerId: 'agent-1',
    ranAt: RAN_AT,
    recall: 1,
    // 1 by the TP + FP = 0 rule whenever nothing landed on a labelled line —
    // which is exactly the number F3 says must not be rendered as "100%".
    precision: 1,
    citationAccuracy: 1,
    tracesPassed: 1,
    tracesTotal: 1,
    costUsd: 0.001,
    agent: null,
    ...over,
  };
}

/**
 * A service wired to an in-memory repository double. `recentRuns` APPLIES the
 * limit it is given, so F2's truncation is reproduced rather than assumed away.
 */
function buildDashboard(opts: {
  cases: { id: string; name: string }[];
  runs: RunWithCaseRow[];
  batches: BatchAggregateRow[];
  agents?: { id: string; name: string }[];
}) {
  const service = new EvalsService({
    db: {} as never,
    agentsRepo: { getById: async () => ({ id: 'agent-1', name: 'Security Reviewer' }) },
  } as never);

  const calls: { recentRuns: { limit: number }[] } = { recentRuns: [] };
  const repo = {
    listCases: async () =>
      opts.cases.map((c) => ({
        id: c.id,
        workspaceId: 'ws-1',
        ownerKind: 'agent' as const,
        ownerId: 'agent-1',
        name: c.name,
        inputDiff: DIFF,
        inputFiles: [],
        inputMeta: {},
        expectedOutput: { expectations: [MUST_FIND] },
        notes: null,
      })),
    countCases: async () => opts.cases.length,
    countCasesByAgent: async () => [{ ownerId: 'agent-1', n: opts.cases.length }],
    agentsWithCases: async () => opts.agents ?? [{ id: 'agent-1', name: 'Security Reviewer' }],
    listBatches: async () => opts.batches,
    recentRuns: async (_ws: string, o: { limit: number }) => {
      calls.recentRuns.push({ limit: o.limit });
      // The real query is `order by ran_at desc, id desc limit N`. Every row of
      // one batch shares a `ran_at`, so the limit cuts INSIDE the newest batch.
      return opts.runs.slice(0, o.limit);
    },
    runsForBatches: async (_ws: string, ids: readonly string[]) =>
      opts.runs.filter((r) =>
        ids.includes((r.run.actualOutput as { batch_id: string }).batch_id),
      ),
  };
  (service as unknown as { repo: Record<string, unknown> }).repo = repo;
  return { service, calls };
}

describe('dashboardForAgent — every case that ran shows a result (AC-16, fix brief F2)', () => {
  it('returns the WHOLE newest batch even when it is larger than RECENT_RUNS_LIMIT', async () => {
    // The reported failure: 30 cases, run once. 30 rows written, 25 returned,
    // five cases rendering "Never run" immediately after passing.
    const n = RECENT_RUNS_LIMIT + 5;
    expect(n).toBeLessThanOrEqual(MAX_CASES_PER_RUN);
    const cases = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `case ${i}` }));
    const runs = cases.map((c) =>
      runRow({ caseId: c.id, caseName: c.name, batchId: 'b-1', landsOnLabelledLine: true }),
    );

    const { service, calls } = buildDashboard({
      cases,
      runs,
      batches: [batchRow({ batchId: 'b-1' })],
    });
    const dash = await service.dashboardForAgent('ws-1', 'agent-1');

    expect(calls.recentRuns[0]!.limit).toBe(AGENT_RECENT_RUNS_LIMIT);
    expect(dash.recent_runs).toHaveLength(n);
    // The thing `EvalsTab` actually derives: a last result for EVERY case.
    const covered = new Set(dash.recent_runs.map((r) => r.case_id));
    for (const c of cases) expect(covered.has(c.id)).toBe(true);
  });

  it('sizes the agent feed by MAX_CASES_PER_RUN, so a full batch always fits', () => {
    // A run is capped at MAX_CASES_PER_RUN cases, so this is the tight bound;
    // raising the cap without raising this reintroduces the truncation.
    expect(AGENT_RECENT_RUNS_LIMIT).toBeGreaterThanOrEqual(MAX_CASES_PER_RUN);
  });
});

describe('per-agent precision_undefined (REC-2, fix brief F3)', () => {
  const cases = [{ id: 'c1', name: 'one' }];

  it('flags an agent whose latest batch produced nothing on a labelled line', async () => {
    const { service } = buildDashboard({
      cases,
      runs: [runRow({ caseId: 'c1', caseName: 'one', batchId: 'b-1', landsOnLabelledLine: false })],
      batches: [batchRow({ batchId: 'b-1' })],
    });

    const dash = await service.dashboardForWorkspace('ws-1');

    // precision is 1 — and it means nothing. The row must say so.
    expect(dash.agents[0]!.current.precision).toBe(1);
    expect(dash.agents[0]!.precision_undefined).toBe(true);
    expect(dash.alert).toBe(PRECISION_UNDEFINED_ALERT);
  });

  it('does NOT flag an agent whose latest batch landed on a labelled line', async () => {
    const { service } = buildDashboard({
      cases,
      runs: [runRow({ caseId: 'c1', caseName: 'one', batchId: 'b-1', landsOnLabelledLine: true })],
      batches: [batchRow({ batchId: 'b-1' })],
    });

    const dash = await service.dashboardForWorkspace('ws-1');
    expect(dash.agents[0]!.precision_undefined).toBe(false);
    expect(dash.alert).toBeNull();
  });

  it('reads the agent’s OWN newest batch, not the newest batch across all agents', async () => {
    // `alert` is derived from batches[0] — agent-2's batch here. If the per-agent
    // flag were the same value, agent-1's row would inherit a verdict about
    // somebody else's run, which is precisely why REC-2 needed a per-agent field.
    const runs = [
      runRow({ caseId: 'c2', caseName: 'two', batchId: 'b-newest', ownerId: 'agent-2', landsOnLabelledLine: false }),
      runRow({ caseId: 'c1', caseName: 'one', batchId: 'b-older', ownerId: 'agent-1', landsOnLabelledLine: true }),
    ];
    const { service } = buildDashboard({
      cases,
      runs,
      // Newest first, as the repository returns them.
      batches: [
        batchRow({ batchId: 'b-newest', ownerId: 'agent-2', ranAt: new Date('2026-09-04T10:00:00.000Z') }),
        batchRow({ batchId: 'b-older', ownerId: 'agent-1' }),
      ],
      agents: [
        { id: 'agent-1', name: 'Security Reviewer' },
        { id: 'agent-2', name: 'Style Reviewer' },
      ],
    });

    const dash = await service.dashboardForWorkspace('ws-1');
    const byId = new Map(dash.agents.map((a) => [a.agent_id, a]));

    expect(dash.alert).toBe(PRECISION_UNDEFINED_ALERT); // about agent-2's batch
    expect(byId.get('agent-2')!.precision_undefined).toBe(true);
    expect(byId.get('agent-1')!.precision_undefined).toBe(false);
  });

  it('gives every batch in the history its own flag, not the newest one’s', async () => {
    const runs = [
      runRow({ caseId: 'c1', caseName: 'one', batchId: 'b-new', landsOnLabelledLine: false }),
      runRow({ caseId: 'c1', caseName: 'one', batchId: 'b-old', landsOnLabelledLine: true }),
    ];
    const { service } = buildDashboard({
      cases,
      runs,
      batches: [
        batchRow({ batchId: 'b-new', ranAt: new Date('2026-09-04T10:00:00.000Z') }),
        batchRow({ batchId: 'b-old' }),
      ],
    });

    const batches = await service.listBatches('ws-1', 'agent-1');
    expect(batches.map((b) => [b.batch_id, b.precision_undefined])).toEqual([
      ['b-new', true],
      ['b-old', false],
    ]);
  });

  it('an agent that has never run is flagged rather than credited with 100%', async () => {
    const { service } = buildDashboard({ cases, runs: [], batches: [] });
    const dash = await service.dashboardForWorkspace('ws-1');
    expect(dash.agents[0]!.last_ran_at).toBeNull();
    expect(dash.agents[0]!.precision_undefined).toBe(true);
    expect(dash.alert).toBeNull(); // no batch at all is not an alert
  });
});
