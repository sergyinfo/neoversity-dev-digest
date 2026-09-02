import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Review } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { ActualOutput } from '../src/modules/evals/contract.js';
import type { InsertEvalRun } from '../src/modules/evals/repository.js';

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

const { EvalsService, MAX_CASES_PER_RUN } = await import('../src/modules/evals/service.js');

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
