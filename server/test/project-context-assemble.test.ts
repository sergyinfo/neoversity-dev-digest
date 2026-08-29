import { describe, it, expect } from 'vitest';
import { assembleProjectContext, type ResolvedDoc } from '../src/modules/project-context/assemble.js';
import {
  PROJECT_CONTEXT_HEADING,
  PROJECT_CONTEXT_TOKEN_BUDGET,
} from '../src/modules/project-context/constants.js';
import { assemblePrompt } from '@devdigest/reviewer-core';

/**
 * L05 (S7) — the shared assemble step.
 *
 * These are UNIT tests of the mechanism. AC-19's outcome is asserted end-to-end
 * in `reviews.it.test.ts`; what is tested here is the property that outcome
 * depends on, because the mechanism is what a later lesson will break: an
 * assembler that returned `['']` for an unreadable document would still satisfy
 * "returns an array" and would still typecheck, and the prompt would silently
 * gain an empty `## Project context` section (R3).
 */

const tokenizer = { count: (text: string) => Math.ceil(text.length / 4) };

const doc = (path: string, content: string | null, over: Partial<ResolvedDoc> = {}): ResolvedDoc => ({
  path,
  origin: 'agent',
  content,
  ...over,
});

describe('assembleProjectContext — the empty-array invariant (AC-19, R3)', () => {
  it('no documents at all ⇒ empty array, empty section, zero tokens', () => {
    const r = assembleProjectContext([], tokenizer);
    expect(r.texts).toEqual([]);
    expect(r.sectionText).toBe('');
    expect(r.sectionTokens).toBe(0);
    expect(r.entries).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.dropped).toEqual([]);
  });

  it('every document unreadable ⇒ STILL an empty array, never one holding an empty string', () => {
    const r = assembleProjectContext(
      [doc('a.md', null, { skipReason: 'file not found' }), doc('b.md', null)],
      tokenizer,
    );
    // `['']` has length > 0 and would render a heading over an empty untrusted
    // block. This assertion, not the length, is the guarantee.
    expect(r.texts).toEqual([]);
    expect(r.texts).not.toContain('');
    expect(r.sectionTokens).toBe(0);
    expect(r.entries.map((e) => e.outcome)).toEqual(['skipped', 'skipped']);
  });

  it('a whitespace-only document is filtered INSIDE the assembler, not by the caller', () => {
    const r = assembleProjectContext([doc('blank.md', '   \n\n\t ')], tokenizer);
    expect(r.texts).toEqual([]);
    expect(r.skipped).toEqual([{ path: 'blank.md', reason: 'empty document' }]);
  });

  it('the engine renders no section for what this returns on an empty run', () => {
    // The other half of AC-19, asserted against the real engine rather than
    // against a belief about it: `specs: []` and no `specs` key at all must
    // produce the same prompt.
    const r = assembleProjectContext([], tokenizer);
    const base = { system: 'sys', diff: 'DIFF', task: 'task' };
    const withEmpty = assemblePrompt({ ...base, specs: r.texts });
    const without = assemblePrompt(base);
    expect(withEmpty.assembly.user).toBe(without.assembly.user);
    expect(withEmpty.assembly.specs).toBeNull();
    expect(withEmpty.assembly.user).not.toContain(PROJECT_CONTEXT_HEADING);
  });
});

describe('assembleProjectContext — order and origin (AC-10)', () => {
  it('preserves the given order and reports each document`s origin', () => {
    const r = assembleProjectContext(
      [
        doc('one.md', 'first'),
        doc('two.md', 'second', { origin: 'skill', viaSkillId: 'skill-7' }),
        doc('three.md', 'third'),
      ],
      tokenizer,
    );
    expect(r.texts).toEqual(['first', 'second', 'third']);
    expect(r.entries.map((e) => e.path)).toEqual(['one.md', 'two.md', 'three.md']);
    expect(r.entries[1]).toMatchObject({ origin: 'skill', via_skill_id: 'skill-7' });
    expect(r.entries[0]!.via_skill_id).toBeUndefined();
  });

  it('numbers the untrusted blocks by SURVIVOR position, matching the engine', () => {
    const r = assembleProjectContext(
      [doc('gone.md', null, { skipReason: 'file not found' }), doc('kept.md', 'body')],
      tokenizer,
    );
    // A skipped document must not consume `spec-0` — the engine numbers what it
    // actually renders, and a gap would make the trace unreadable.
    expect(r.sectionText).toContain('<untrusted source="spec-0">');
    expect(r.sectionText).not.toContain('spec-1');
  });
});

describe('assembleProjectContext — budget (AC-22, REQ-13)', () => {
  const budgetTokens = 200;

  it('drops WHOLE documents and never truncates', () => {
    const big = 'B'.repeat(4000); // ~1000 tokens under the stub counter
    const r = assembleProjectContext(
      [doc('small.md', 'tiny'), doc('huge.md', big)],
      tokenizer,
      { budgetTokens },
    );

    expect(r.texts).toEqual(['tiny']);
    expect(r.dropped.map((d) => d.path)).toEqual(['huge.md']);
    // Not a prefix, not an ellipsis, not a marker — the document is absent.
    expect(r.sectionText).not.toContain('BBBB');
    expect(r.sectionTokens).toBeLessThanOrEqual(budgetTokens);
  });

  it('records every dropped document with a reason that names a path and a cause only', () => {
    const big = 'B'.repeat(4000);
    const r = assembleProjectContext(
      [doc('a.md', big), doc('b.md', big)],
      tokenizer,
      { budgetTokens },
    );
    expect(r.dropped).toHaveLength(2);
    for (const d of r.dropped) {
      expect(d.reason).toContain('budget');
      // §7 — a reason never carries content.
      expect(d.reason).not.toContain('B');
    }
    expect(r.entries.every((e) => e.outcome === 'dropped_budget')).toBe(true);
  });

  it('a later, smaller document still fits after a big one is dropped', () => {
    // Per-document rather than per-position: this is what makes AC-27's "the
    // marked set is identical to the set the run records" a set comparison.
    const r = assembleProjectContext(
      [doc('huge.md', 'B'.repeat(4000)), doc('small.md', 'fits')],
      tokenizer,
      { budgetTokens },
    );
    expect(r.texts).toEqual(['fits']);
    expect(r.dropped.map((d) => d.path)).toEqual(['huge.md']);
    expect(r.entries.map((e) => e.outcome)).toEqual(['dropped_budget', 'injected']);
  });

  it('defaults to the 8 000-token section budget', () => {
    const r = assembleProjectContext([doc('a.md', 'x'.repeat(40_000))], tokenizer);
    expect(PROJECT_CONTEXT_TOKEN_BUDGET).toBe(8_000);
    expect(r.dropped.map((d) => d.path)).toEqual(['a.md']);
  });
});

describe('assembleProjectContext — sectionTokens (BQ-1/a, AC-26)', () => {
  it('counts the heading PLUS the joined blocks, not just the blocks', () => {
    const r = assembleProjectContext([doc('a.md', 'hello world')], tokenizer);

    expect(r.sectionText.startsWith(`${PROJECT_CONTEXT_HEADING}\n`)).toBe(true);
    expect(r.sectionTokens).toBe(tokenizer.count(r.sectionText));

    // The distinction BQ-1 exists to create: `prompt-log.ts` counts
    // `assembly.specs`, which is the blocks WITHOUT the heading, so the two
    // numbers are different by construction and must not be conflated.
    const blocksOnly = r.sectionText.slice(PROJECT_CONTEXT_HEADING.length + 1);
    expect(tokenizer.count(blocksOnly)).toBeLessThan(r.sectionTokens);
  });

  it('the section text is byte-identical to what the engine renders', () => {
    // Assumption A1: reviewer-core exports neither the heading nor the join, so
    // this module restates two literals. This is the mechanical detector for
    // that duplication drifting.
    const r = assembleProjectContext([doc('a.md', 'one'), doc('b.md', 'two')], tokenizer);
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      task: 'task',
      specs: r.texts,
    });
    expect(assembly.user).toContain(r.sectionText);
    expect(r.sectionText).toBe(`${PROJECT_CONTEXT_HEADING}\n${assembly.specs}`);
  });
});
