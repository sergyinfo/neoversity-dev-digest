import { describe, it, expect } from 'vitest';
import type { Risk } from '@devdigest/shared';
import type { BlastResponse } from '../src/modules/blast/contract.js';
import type { ModelBrief } from '../src/modules/brief/contract.js';
import {
  buildAllowList,
  capRiskLevel,
  filterReferences,
  type BlastGrounding,
} from '../src/modules/brief/grounding.js';

/**
 * L05 grounding — REQ-6's exact-match discard filter and REQ-7's lower-only cap.
 *
 * The theme of the whole file: a reference is either something we OBSERVED, or
 * it is gone. Nothing here is ever repaired, and nothing is ever substituted in
 * place of what was removed.
 */

/** The PR's changed files. `src/api/users.ts` is the near-match trap for AC-13. */
const CHANGED = ['src/config.ts', 'src/api/users.ts', 'src/modules/brief/contract.ts'];

/**
 * A blast map whose caller file `src/server.ts` is deliberately NOT in the diff
 * — that is the whole of AC-14 — plus one endpoint, one cron and one prior-PR
 * overlap, so the union in §10 is exercised in every one of its six arms.
 */
const BLAST: BlastGrounding = {
  map: {
    changed_symbols: [{ name: 'loadConfig', file: 'src/config.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'loadConfig',
        callers: [{ name: 'bootstrap', file: 'src/server.ts', line: 12 }],
        endpoints_affected: ['GET /pulls/:id'],
        crons_affected: ['nightly-digest'],
      },
    ],
  },
  prior_prs: [
    {
      number: 7,
      title: 'Earlier touch of the same area',
      author: 'someone',
      updated_at: '2026-08-01T00:00:00.000Z',
      overlapping_files: ['src/legacy/overlap.ts'],
    },
  ],
};

function risk(over: Partial<Risk> = {}): Risk {
  return {
    kind: 'regression',
    title: 'A caller may break',
    explanation: 'The signature changed and a caller was not updated.',
    severity: 'low',
    file_refs: [],
    ...over,
  };
}

function brief(over: Partial<ModelBrief> = {}): ModelBrief {
  return {
    what: 'Widens the config loader.',
    why: 'The default branch was wrong for repos that use develop.',
    risk_level: 'low',
    risks: [],
    review_focus: [],
    ...over,
  };
}

describe('buildAllowList — §10 union', () => {
  it('unions changed files with every blast arm', () => {
    const allow = buildAllowList(CHANGED, BLAST);

    for (const path of CHANGED) expect(allow.all.has(path)).toBe(true);
    expect(allow.all.has('src/server.ts')).toBe(true); // downstream caller file
    expect(allow.all.has('GET /pulls/:id')).toBe(true); // endpoints_affected
    expect(allow.all.has('nightly-digest')).toBe(true); // crons_affected
    expect(allow.all.has('src/legacy/overlap.ts')).toBe(true); // prior_prs overlap
  });

  it('keeps changed files as a narrower tier than the whole list', () => {
    const allow = buildAllowList(CHANGED, BLAST);
    expect([...allow.changedFiles].sort()).toEqual([...CHANGED].sort());
    // The caller file is grounded for a RISK but is not a changed file, because
    // its line numbers are valid at indexed_sha, not at the PR head.
    expect(allow.changedFiles.has('src/server.ts')).toBe(false);
  });

  it('a degraded or absent map leaves the changed-file list as the whole allow-list', () => {
    const allow = buildAllowList(CHANGED, null);
    expect([...allow.all].sort()).toEqual([...CHANGED].sort());
    expect(allow.all.has('src/server.ts')).toBe(false);
  });

  it('reference-document CONTENT contributes no entries — a claim is not an observation', () => {
    // A spec that names a path does not make that path something we saw. The
    // enforcement is structural: buildAllowList has nowhere to put a document.
    const documentBody = `The retry lives in src/adapters/http/retry.ts and must not change.`;
    const allow = buildAllowList(CHANGED, BLAST);
    expect(allow.all.has('src/adapters/http/retry.ts')).toBe(false);
    expect(documentBody).toContain('src/adapters/http/retry.ts');

    // …and a model risk citing it is therefore discarded.
    const result = filterReferences(
      brief({ risks: [risk({ file_refs: ['src/adapters/http/retry.ts'] })] }),
      allow,
    );
    expect(result.document.risks[0]!.file_refs).toEqual([]);
    expect(result.discarded).toBe(1);
  });
});

describe('filterReferences — REQ-6', () => {
  const allow = buildAllowList(CHANGED, BLAST);

  it('AC-12 — a nonexistent path is discarded and counted', () => {
    const result = filterReferences(
      brief({
        review_focus: [
          { file: 'src/does-not-exist.ts', line: 4, reason: 'invented' },
          { file: 'src/config.ts', line: 12, reason: 'real' },
        ],
      }),
      allow,
    );

    expect(result.document.review_focus).toEqual([
      { file: 'src/config.ts', line: 12, reason: 'real' },
    ]);
    expect(result.discarded).toBe(1);
  });

  it('AC-13 — a near match is DISCARDED, not corrected to the real file', () => {
    const result = filterReferences(
      brief({
        risks: [risk({ file_refs: ['src/api/user.ts'] })],
        review_focus: [{ file: 'src/api/user.ts', line: 46, reason: 'n+1 query' }],
      }),
      allow,
    );

    // `src/api/users.ts` IS in the diff and is one character away. Nothing in
    // the output may mention it: repairing the path would silently assert a
    // different claim over a file the model never reasoned about.
    expect(JSON.stringify(result.document)).not.toContain('src/api/users.ts');
    expect(result.document.risks[0]!.file_refs).toEqual([]);
    expect(result.document.review_focus).toEqual([]);
    expect(result.discarded).toBe(2);
  });

  it('AC-14 — a blast caller file absent from the diff survives in a risk', () => {
    const result = filterReferences(
      brief({
        risks: [risk({ severity: 'medium', file_refs: ['src/server.ts', 'GET /pulls/:id'] })],
        risk_level: 'medium',
      }),
      allow,
    );

    expect(result.document.risks[0]!.file_refs).toEqual(['src/server.ts', 'GET /pulls/:id']);
    expect(result.discarded).toBe(0);
  });

  it('AC-15 — when every focus reference is discarded the list is empty, with no substitution', () => {
    const result = filterReferences(
      brief({
        review_focus: [
          { file: 'src/nope-a.ts', line: 1, reason: 'a' },
          { file: 'src/nope-b.ts', line: null, reason: 'b' },
        ],
      }),
      allow,
    );

    expect(result.document.review_focus).toEqual([]);
    expect(result.discarded).toBe(2);
    // No changed file was quietly promoted into the gap.
    for (const path of CHANGED) {
      expect(JSON.stringify(result.document.review_focus)).not.toContain(path);
    }
  });

  it('review_focus is CHANGED-file only, while risks may span the whole allow-list', () => {
    const result = filterReferences(
      brief({
        risks: [risk({ file_refs: ['src/server.ts'] })],
        review_focus: [{ file: 'src/server.ts', line: 12, reason: 'the caller' }],
      }),
      allow,
    );

    expect(result.document.risks[0]!.file_refs).toEqual(['src/server.ts']);
    expect(result.document.review_focus).toEqual([]);
    expect(result.discarded).toBe(1);
  });

  it('keeps a risk whose every reference was discarded, with an empty file_refs', () => {
    // REQ-6 discards a REFERENCE, not a risk. Dropping the risk would let a
    // mistyped path suppress a finding.
    const result = filterReferences(
      brief({ risks: [risk({ title: 'Still worth saying', file_refs: ['src/ghost.ts'] })] }),
      allow,
    );

    expect(result.document.risks).toHaveLength(1);
    expect(result.document.risks[0]!.title).toBe('Still worth saying');
    expect(result.document.risks[0]!.file_refs).toEqual([]);
  });

  it('leaves what / why untouched — grounding filters references, not prose', () => {
    const input = brief({ what: 'W', why: 'Y' });
    const result = filterReferences(input, allow);
    expect(result.document.what).toBe('W');
    expect(result.document.why).toBe('Y');
  });
});

describe('capRiskLevel — REQ-7, lower only', () => {
  it('AC-16 — "high" with all surviving risks at "low" becomes "low"', () => {
    const result = filterReferences(
      brief({
        risk_level: 'high',
        risks: [
          risk({ severity: 'low', file_refs: ['src/config.ts'] }),
          risk({ severity: 'low', file_refs: ['src/server.ts'] }),
        ],
      }),
      buildAllowList(CHANGED, BLAST),
    );
    expect(result.document.risk_level).toBe('low');
  });

  it('AC-17 — "low" with a surviving "high" risk STAYS "low"', () => {
    const result = filterReferences(
      brief({ risk_level: 'low', risks: [risk({ severity: 'high' })] }),
      buildAllowList(CHANGED, BLAST),
    );
    // The rule only ever lowers. Raising it would mean our code asserting a
    // level the model did not.
    expect(result.document.risk_level).toBe('low');
  });

  it('no surviving risks → "low", whatever the model claimed', () => {
    expect(capRiskLevel('high', [])).toBe('low');
    expect(capRiskLevel('medium', [])).toBe('low');
    expect(capRiskLevel('low', [])).toBe('low');
  });

  it('takes the highest surviving severity, not the first', () => {
    expect(capRiskLevel('high', [risk({ severity: 'low' }), risk({ severity: 'medium' })])).toBe(
      'medium',
    );
  });

  it('a risk whose own severity failed validation can never RAISE the level', () => {
    // Upstream `ModelBrief.parse` makes this unreachable — which is exactly why
    // it is asserted here: a safety property that holds only because another
    // function ran first is not one.
    const malformed = risk({ severity: 'CRITICAL' as never });
    expect(capRiskLevel('low', [malformed])).toBe('low');
    expect(capRiskLevel('high', [malformed])).toBe('low');
    expect(capRiskLevel('high', [malformed, risk({ severity: 'medium' })])).toBe('medium');
  });
});

describe('purity — the module is data in, data out', () => {
  it('does not mutate the brief it was given', () => {
    const input = brief({
      risks: [risk({ file_refs: ['src/config.ts', 'src/ghost.ts'] })],
      review_focus: [{ file: 'src/ghost.ts', line: 1, reason: 'x' }],
    });
    const snapshot = JSON.stringify(input);

    filterReferences(input, buildAllowList(CHANGED, BLAST));

    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is deterministic — the same inputs give the same result', () => {
    const input = brief({ risks: [risk({ file_refs: ['src/config.ts'] })] });
    const allow = buildAllowList(CHANGED, BLAST);
    expect(filterReferences(input, allow)).toEqual(filterReferences(input, allow));
  });
});

/**
 * `BlastGrounding` is a `Pick` of the shipped `BlastResponse`, so the two
 * cannot drift apart. Stated as a type, not a value: `server/test/` is outside
 * `tsconfig.json`'s `include` (`server/INSIGHTS.md`, 2026-08-17), so this is a
 * note for the editor and for the next reader, not a gate.
 */
type _AssertGroundingIsAPickOfTheEnvelope =
  BlastGrounding extends Pick<BlastResponse, 'map' | 'prior_prs'> ? true : never;
