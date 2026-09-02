import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import {
  EvalExpectation,
  ExpectedOutput,
  ActualOutput,
  EvalAgentSnapshot,
  CreateEvalCaseBody,
  RunEvalBody,
  EvalBatchSummary,
} from '../src/modules/evals/contract.js';

/**
 * L06 (S1) — the module-local eval envelope.
 *
 * `server/src/modules/evals/contract.ts` fixes the shape of the two jsonb
 * columns the whole feature hangs off. Both are `z.unknown()` in the given
 * shared contract, so NOTHING enforces them at the database or at the route:
 * the run loop writes `actual_output` and the compare modal reads it, and this
 * file is the only place the two are made to agree.
 *
 * That also means the usual "a green typecheck proves it" does not apply — and
 * doubly so here, since `server/tsconfig.json` sets `"include": ["src/**\/*.ts"]`
 * and never typechecks `test/` at all (`server/INSIGHTS.md`, 2026-08-17).
 * The parses below are the check.
 */

/** A complete `Finding` — every required key of the shared contract. */
const finding: Finding = {
  id: 'f-1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Missing rate limit on the public webhook',
  file: 'src/api/public/webhooks.ts',
  start_line: 41,
  end_line: 48,
  explanation: 'The handler is unauthenticated and unthrottled.',
  confidence: 0.9,
};

const skill = { id: 's-1', name: 'OWASP rubric', version: 3, content_hash: 'sha256:abc' };

const agent = {
  id: 'a-1',
  name: 'Security Reviewer',
  system_prompt: 'You are a security reviewer.',
  model: 'anthropic/claude-sonnet-4',
  skills: [skill],
};

describe('EvalExpectation', () => {
  it('round-trips a must_find expectation, carrying the optional finding metadata', () => {
    const parsed = EvalExpectation.parse({
      kind: 'must_find',
      file: 'src/api/public/webhooks.ts',
      start_line: 41,
      end_line: 48,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Missing rate limit on the public webhook',
    });

    expect(parsed.kind).toBe('must_find');
    // Narrowed by the discriminant — these keys only exist on this member.
    if (parsed.kind !== 'must_find') throw new Error('discriminant did not narrow');
    expect(parsed.severity).toBe('CRITICAL');
    expect(parsed.category).toBe('security');
    expect(parsed.title).toBe('Missing rate limit on the public webhook');
  });

  it('accepts a must_find with the optional metadata absent (Edge-3: the case outlives its finding)', () => {
    const parsed = EvalExpectation.parse({
      kind: 'must_find',
      file: 'src/config.ts',
      start_line: 10,
      end_line: 10,
    });

    if (parsed.kind !== 'must_find') throw new Error('discriminant did not narrow');
    expect(parsed.severity).toBeUndefined();
    expect(parsed.title).toBeUndefined();
  });

  it('round-trips a must_not_flag expectation as file + range ONLY', () => {
    const parsed = EvalExpectation.parse({
      kind: 'must_not_flag',
      file: 'src/api/users.ts',
      start_line: 120,
      end_line: 124,
      // A dismissal says "nothing worth reporting here", not "nothing of THIS
      // severity" — so severity must not survive onto the stored expectation.
      severity: 'SUGGESTION',
    });

    expect(parsed).toEqual({
      kind: 'must_not_flag',
      file: 'src/api/users.ts',
      start_line: 120,
      end_line: 124,
    });
    expect('severity' in parsed).toBe(false);
  });

  it('rejects an expectation with no file — the match rule is file equality, so a fileless expectation can never match', () => {
    for (const kind of ['must_find', 'must_not_flag'] as const) {
      const missing = EvalExpectation.safeParse({ kind, start_line: 1, end_line: 2 });
      expect(missing.success).toBe(false);

      // An empty string is the same failure wearing a disguise: it parses as a
      // string but equals no real path.
      const empty = EvalExpectation.safeParse({ kind, file: '', start_line: 1, end_line: 2 });
      expect(empty.success).toBe(false);
    }
  });

  it('rejects an unknown kind rather than silently keeping it', () => {
    const res = EvalExpectation.safeParse({
      kind: 'should_warn',
      file: 'src/config.ts',
      start_line: 1,
      end_line: 2,
    });
    expect(res.success).toBe(false);
  });
});

describe('ExpectedOutput', () => {
  it('holds a mixed set of both kinds', () => {
    const parsed = ExpectedOutput.parse({
      expectations: [
        { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 3 },
        { kind: 'must_not_flag', file: 'b.ts', start_line: 7, end_line: 9 },
      ],
    });
    expect(parsed.expectations.map((e) => e.kind)).toEqual(['must_find', 'must_not_flag']);
  });

  it('accepts an empty expectation set (spec Edge case: empty expectation set)', () => {
    expect(ExpectedOutput.parse({ expectations: [] }).expectations).toEqual([]);
  });
});

describe('ActualOutput', () => {
  it('round-trips a populated envelope', () => {
    const parsed = ActualOutput.parse({
      batch_id: 'b-1',
      findings: [finding],
      grounded_ids: ['f-1'],
      matches: [{ expectation_index: 0, finding_id: 'f-1' }],
      agent,
    });

    expect(parsed.batch_id).toBe('b-1');
    expect(parsed.findings[0]?.id).toBe('f-1');
    expect(parsed.grounded_ids).toEqual(['f-1']);
    expect(parsed.agent.skills[0]?.content_hash).toBe('sha256:abc');
  });

  it('accepts an envelope with an empty findings array — an agent that produced nothing is a scoreable outcome, not a broken row (Edge-2)', () => {
    const parsed = ActualOutput.parse({
      batch_id: 'b-1',
      findings: [],
      grounded_ids: [],
      // The must_find went unmatched: present-and-null, never absent.
      matches: [{ expectation_index: 0, finding_id: null }],
      agent,
    });

    expect(parsed.findings).toEqual([]);
    expect(parsed.matches[0]?.finding_id).toBeNull();
  });

  it('requires a batch_id — without it a row cannot be grouped into the run it belongs to', () => {
    const res = ActualOutput.safeParse({
      findings: [],
      grounded_ids: [],
      matches: [],
      agent,
    });
    expect(res.success).toBe(false);
  });
});

describe('EvalAgentSnapshot', () => {
  it('requires id and name (REC-1) — the workspace dashboard has no other source of agent attribution', () => {
    for (const key of ['id', 'name'] as const) {
      const { [key]: _dropped, ...rest } = agent;
      const res = EvalAgentSnapshot.safeParse(rest);
      expect(res.success, `snapshot without ${key} must be rejected`).toBe(false);

      const blank = EvalAgentSnapshot.safeParse({ ...agent, [key]: '' });
      expect(blank.success, `snapshot with an empty ${key} must be rejected`).toBe(false);
    }
  });

  it('requires a content_hash on EVERY skill entry (REC-6)', () => {
    const { content_hash: _dropped, ...hashless } = skill;

    // Not just the first entry: one unhashed skill in the list is enough to make
    // "the snapshots are identical" an unsafe conclusion.
    expect(EvalAgentSnapshot.safeParse({ ...agent, skills: [hashless] }).success).toBe(false);
    expect(EvalAgentSnapshot.safeParse({ ...agent, skills: [skill, hashless] }).success).toBe(false);
    expect(
      EvalAgentSnapshot.safeParse({ ...agent, skills: [{ ...skill, content_hash: '' }] }).success,
    ).toBe(false);

    // An agent with no linked skills at all is fine — that is a real state.
    expect(EvalAgentSnapshot.safeParse({ ...agent, skills: [] }).success).toBe(true);
  });

  it('does NOT accept a bare skill slug in place of a snapshot — `skills` has no slug column', () => {
    expect(EvalAgentSnapshot.safeParse({ ...agent, skills: ['owasp-rubric'] }).success).toBe(false);
  });
});

describe('request bodies', () => {
  it('CreateEvalCaseBody tolerates no body at all and normalises it to an object', () => {
    expect(CreateEvalCaseBody.parse(undefined)).toEqual({});
    expect(CreateEvalCaseBody.parse(null)).toEqual({});
    expect(CreateEvalCaseBody.parse({})).toEqual({});
  });

  it('CreateEvalCaseBody carries a uuid agent_id and rejects anything else (BQ-2a fallback owner)', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(CreateEvalCaseBody.parse({ agent_id: id }).agent_id).toBe(id);
    // Not a uuid: a clean 422 at the edge instead of Postgres 22P02 as a 500.
    expect(CreateEvalCaseBody.safeParse({ agent_id: 'security-reviewer' }).success).toBe(false);
  });

  it('RunEvalBody accepts an absent body and ignores anything sent', () => {
    expect(RunEvalBody.parse(undefined)).toEqual({});
    expect(RunEvalBody.parse({})).toEqual({});
    // Unknown keys are stripped, not rejected — nothing on the body is read.
    expect(RunEvalBody.parse({ cases: ['a'] })).toEqual({});
  });
});

describe('EvalBatchSummary', () => {
  it('round-trips a batch with its snapshot and batch-level trace counts (BQ-4a)', () => {
    const parsed = EvalBatchSummary.parse({
      batch_id: 'b-1',
      ran_at: '2026-09-03T10:00:00.000Z',
      recall: 0.75,
      precision: 1,
      citation_accuracy: 0.5,
      traces_passed: 6,
      traces_total: 8,
      cost_usd: 0.0123,
      agent,
    });

    expect(parsed.traces_passed).toBe(6);
    expect(parsed.agent?.system_prompt).toBe('You are a security reviewer.');
  });

  it('allows a null agent and a null cost, and reports a partial batch (Edge-7)', () => {
    const parsed = EvalBatchSummary.parse({
      batch_id: 'b-2',
      ran_at: '2026-09-03T10:00:00.000Z',
      recall: 0,
      precision: 1,
      citation_accuracy: 1,
      // A run that threw mid-set: fewer traces than the case set holds.
      traces_passed: 0,
      traces_total: 2,
      cost_usd: null,
      agent: null,
    });

    expect(parsed.agent).toBeNull();
    expect(parsed.cost_usd).toBeNull();
    expect(parsed.traces_total).toBe(2);
  });

  it('rejects a metric outside 0..1 — a rate that cannot exist is a scorer bug, not data', () => {
    const base = {
      batch_id: 'b-3',
      ran_at: '2026-09-03T10:00:00.000Z',
      recall: 0.5,
      precision: 0.5,
      citation_accuracy: 0.5,
      traces_passed: 1,
      traces_total: 1,
      cost_usd: null,
      agent: null,
    };
    expect(EvalBatchSummary.safeParse({ ...base, recall: 1.5 }).success).toBe(false);
    expect(EvalBatchSummary.safeParse({ ...base, precision: -0.1 }).success).toBe(false);
  });
});
