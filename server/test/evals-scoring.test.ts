import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Finding } from '@devdigest/shared';
import type { EvalExpectation } from '../src/modules/evals/contract.js';
import {
  overlaps,
  matchFindings,
  classifyFindings,
  score,
} from '../src/modules/evals/scoring.js';

/**
 * L06 S2 — the deterministic scorer. One named test per bullet in the spec's
 * §Edge cases, plus the four division rules and the purity guarantee.
 *
 * Everything here is arithmetic on literals: no Postgres, no container, no
 * mock LLM. If this file ever needs one of those, the scorer stopped being pure.
 */

const finding = (over: Partial<Finding> & Pick<Finding, 'id' | 'file' | 'start_line' | 'end_line'>): Finding => ({
  severity: 'WARNING',
  category: 'bug',
  title: 'A finding',
  explanation: 'because',
  confidence: 0.9,
  ...over,
});

const mustFind = (file: string, start: number, end: number): EvalExpectation => ({
  kind: 'must_find',
  file,
  start_line: start,
  end_line: end,
});

const mustNotFlag = (file: string, start: number, end: number): EvalExpectation => ({
  kind: 'must_not_flag',
  file,
  start_line: start,
  end_line: end,
});

describe('overlaps — the match rule (AC-11)', () => {
  it('is inclusive on both ends', () => {
    expect(overlaps({ start: 10, end: 10 }, { start: 10, end: 10 })).toBe(true);
    expect(overlaps({ start: 1, end: 10 }, { start: 10, end: 20 })).toBe(true);
    expect(overlaps({ start: 10, end: 20 }, { start: 1, end: 10 })).toBe(true);
  });

  it('is false for disjoint ranges', () => {
    expect(overlaps({ start: 1, end: 9 }, { start: 10, end: 20 })).toBe(false);
  });
});

describe('scoring — the division rules', () => {
  it('empty expectation set: recall 1, precision 1 (vacuous), pass true', () => {
    const s = score({
      expectations: [],
      findings: [finding({ id: 'f1', file: 'a.ts', start_line: 1, end_line: 2 })],
      keptCount: 1,
      droppedCount: 0,
    });
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.precision_undefined).toBe(true);
    expect(s.pass).toBe(true);
    expect(s.matches).toEqual([]);
  });

  it('zero findings produced: recall 0, precision 1, citation_accuracy 1 (Edge-2)', () => {
    const s = score({
      expectations: [mustFind('a.ts', 10, 20)],
      findings: [],
      keptCount: 0,
      droppedCount: 0,
    });
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(1);
    expect(s.precision_undefined).toBe(true);
    expect(s.citation_accuracy).toBe(1);
    expect(s.pass).toBe(false);
    expect(s.matches).toEqual([{ expectation_index: 0, finding_id: null }]);
  });

  it('recall is 1 when the set holds no must_find expectation (AC-12)', () => {
    const s = score({
      expectations: [mustNotFlag('a.ts', 10, 20)],
      findings: [],
      keptCount: 0,
      droppedCount: 0,
    });
    expect(s.recall).toBe(1);
    expect(s.pass).toBe(true);
  });

  it('citation_accuracy is kept / (kept + dropped) (AC-14)', () => {
    const s = score({
      expectations: [],
      findings: [finding({ id: 'f1', file: 'a.ts', start_line: 1, end_line: 1 })],
      keptCount: 1,
      droppedCount: 3,
    });
    expect(s.citation_accuracy).toBe(0.25);
  });
});

describe('scoring — the spec edge cases', () => {
  it('adjacent but non-overlapping lines are NOT a match (Edge-4)', () => {
    const s = score({
      expectations: [mustFind('a.ts', 10, 12)],
      findings: [finding({ id: 'f1', file: 'a.ts', start_line: 13, end_line: 15 })],
      keptCount: 1,
      droppedCount: 0,
    });
    expect(s.matches[0]!.finding_id).toBeNull();
    expect(s.recall).toBe(0);
    // The finding landed on no labelled line at all, so it is IGNORED, not an FP.
    expect(s.tp).toBe(0);
    expect(s.fp).toBe(0);
    expect(s.precision_undefined).toBe(true);
  });

  it('a renamed file is NOT a match, even on identical lines (Edge-5)', () => {
    const s = score({
      expectations: [mustFind('src/old.ts', 10, 20)],
      findings: [finding({ id: 'f1', file: 'src/new.ts', start_line: 10, end_line: 20 })],
      keptCount: 1,
      droppedCount: 0,
    });
    expect(s.recall).toBe(0);
    expect(s.matches[0]!.finding_id).toBeNull();
  });

  it('two expectations on the same lines: one finding satisfies exactly one (Edge-6)', () => {
    const s = score({
      expectations: [mustFind('a.ts', 10, 20), mustFind('a.ts', 10, 20)],
      findings: [finding({ id: 'f1', file: 'a.ts', start_line: 12, end_line: 14 })],
      keptCount: 1,
      droppedCount: 0,
    });
    expect(s.matches).toEqual([
      { expectation_index: 0, finding_id: 'f1' },
      { expectation_index: 1, finding_id: null },
    ]);
    expect(s.recall).toBe(0.5);
    expect(s.pass).toBe(false);
  });

  it('the greedy walk is file-ordered, so the result does not depend on array order', () => {
    const a = mustFind('a.ts', 10, 20);
    const z = mustFind('z.ts', 10, 20);
    const fa = finding({ id: 'fa', file: 'a.ts', start_line: 11, end_line: 11 });
    const fz = finding({ id: 'fz', file: 'z.ts', start_line: 11, end_line: 11 });

    const forwards = score({ expectations: [a, z], findings: [fa, fz], keptCount: 2, droppedCount: 0 });
    const backwards = score({ expectations: [z, a], findings: [fz, fa], keptCount: 2, droppedCount: 0 });

    expect(forwards.matches).toEqual([
      { expectation_index: 0, finding_id: 'fa' },
      { expectation_index: 1, finding_id: 'fz' },
    ]);
    // Indices follow the ORIGINAL array; the pairing is identical either way.
    expect(backwards.matches).toEqual([
      { expectation_index: 0, finding_id: 'fz' },
      { expectation_index: 1, finding_id: 'fa' },
    ]);
    expect(forwards.recall).toBe(backwards.recall);
  });
});

describe('scoring — precision (AC-13)', () => {
  it('a must_not_flag hit lowers precision and fails the case', () => {
    const s = score({
      expectations: [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 50, 60)],
      findings: [
        finding({ id: 'good', file: 'a.ts', start_line: 12, end_line: 12 }),
        finding({ id: 'noise', file: 'a.ts', start_line: 55, end_line: 55 }),
      ],
      keptCount: 2,
      droppedCount: 0,
    });
    expect(s.tp).toBe(1);
    expect(s.fp).toBe(1);
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(1);
    expect(s.pass).toBe(false); // AC-15: a must_not_flag matched
  });

  it('counts every finding piled on one must_not_flag range, not just the first', () => {
    const s = score({
      expectations: [mustNotFlag('a.ts', 10, 20)],
      findings: [
        finding({ id: 'n1', file: 'a.ts', start_line: 11, end_line: 11 }),
        finding({ id: 'n2', file: 'a.ts', start_line: 12, end_line: 12 }),
        finding({ id: 'n3', file: 'a.ts', start_line: 13, end_line: 13 }),
      ],
      keptCount: 3,
      droppedCount: 0,
    });
    // The one-to-one assignment claims one finding; precision counts all three.
    expect(s.matches).toEqual([{ expectation_index: 0, finding_id: 'n1' }]);
    expect(s.fp).toBe(3);
    expect(s.precision).toBe(0);
  });

  it('findings matching neither kind are ignored by precision', () => {
    const s = score({
      expectations: [mustFind('a.ts', 10, 20)],
      findings: [
        finding({ id: 'good', file: 'a.ts', start_line: 11, end_line: 11 }),
        finding({ id: 'unlabelled', file: 'b.ts', start_line: 99, end_line: 99 }),
      ],
      keptCount: 2,
      droppedCount: 0,
    });
    expect(s.tp).toBe(1);
    expect(s.fp).toBe(0);
    expect(s.precision).toBe(1);
    expect(s.precision_undefined).toBe(false);
  });

  it('must_find wins when a finding overlaps both kinds', () => {
    const labels = classifyFindings(
      [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 15, 25)],
      [finding({ id: 'f1', file: 'a.ts', start_line: 16, end_line: 17 })],
    );
    expect(labels).toEqual(['tp']);
  });
});

describe('scoring — pass semantics (AC-15)', () => {
  it('is true only when every must_find matched AND no must_not_flag matched', () => {
    const expectations = [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 50, 60)];
    const good = finding({ id: 'good', file: 'a.ts', start_line: 11, end_line: 11 });
    const noise = finding({ id: 'noise', file: 'a.ts', start_line: 55, end_line: 55 });

    const both = score({ expectations, findings: [good], keptCount: 1, droppedCount: 0 });
    expect(both.pass).toBe(true);

    const missedMustFind = score({ expectations, findings: [], keptCount: 0, droppedCount: 0 });
    expect(missedMustFind.pass).toBe(false);

    const hitMustNotFlag = score({
      expectations,
      findings: [good, noise],
      keptCount: 2,
      droppedCount: 0,
    });
    expect(hitMustNotFlag.pass).toBe(false);
  });
});

describe('matchFindings — one finding is claimed at most once', () => {
  it('does not offer a claimed finding to a later expectation', () => {
    const matches = matchFindings(
      [mustFind('a.ts', 10, 20), mustFind('a.ts', 15, 25)],
      [finding({ id: 'only', file: 'a.ts', start_line: 16, end_line: 16 })],
    );
    expect(matches.filter((m) => m.finding_id === 'only')).toHaveLength(1);
  });
});

describe('scoring.ts is pure (AC-10 / REC-4)', () => {
  /**
   * The static half of the "zero model calls" guarantee, mirrored by
   * `verify:l06`'s comment-stripped grep. Asserted here too so the invariant
   * fails in the unit suite — the cheapest place — rather than only in bash.
   */
  it('imports nothing with I/O and calls no model', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/modules/evals/scoring.ts', import.meta.url)),
      'utf8',
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');

    for (const forbidden of [
      'container',
      'completeStructured',
      '.complete(',
      'node:fs',
      'drizzle',
      'db/',
      'Date.now',
      'Math.random',
      'randomUUID',
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // Every import is a TYPE import — nothing is pulled in at runtime.
    const imports = code.match(/^import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line.startsWith('import type ')).toBe(true);
  });
});
