import { describe, it, expect } from 'vitest';
import { taskLine, findingRowToDto } from '../src/modules/reviews/helpers.js';
import { Finding } from '@devdigest/shared';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

describe('findingRowToDto — nullable columns keep their null', () => {
  /** A findings row as drizzle returns it. Only the fields the mapper reads. */
  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: 'f1',
      reviewId: 'r1',
      severity: 'WARNING',
      category: 'security',
      title: 'A title',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      rationale: 'The DB column is `rationale`.',
      suggestion: null,
      confidence: 0.9,
      kind: 'finding',
      trifectaComponents: null,
      acceptedAt: null,
      dismissedAt: null,
      ...over,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  it('maps a NULL suggestion to null, not to an empty string', () => {
    // The column is nullable and not every finding carries a fix. Inventing ''
    // told every client "there is a suggestion, it is blank" — a different claim
    // from "there is none", and the one the UI branches on (`f.suggestion &&`).
    expect(findingRowToDto(row()).suggestion).toBeNull();
  });

  it('passes a real suggestion through unchanged', () => {
    expect(findingRowToDto(row({ suggestion: 'Move it to env.' })).suggestion).toBe(
      'Move it to env.',
    );
  });

  it('preserves the empty string as itself, distinct from NULL', () => {
    expect(findingRowToDto(row({ suggestion: '' })).suggestion).toBe('');
  });

  it('still maps the `rationale` column onto the `explanation` field', () => {
    expect(findingRowToDto(row()).explanation).toBe('The DB column is `rationale`.');
  });

  it('produces a DTO the shared contract accepts, with and without a suggestion', () => {
    for (const suggestion of [null, 'Do the thing']) {
      const parsed = Finding.safeParse(findingRowToDto(row({ suggestion })));
      expect(parsed.success).toBe(true);
    }
  });
});
