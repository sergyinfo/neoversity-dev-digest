import { describe, it, expect } from 'vitest';
import { MovedInput } from '../src/modules/brief/contract.js';
import { ASSEMBLER_VERSION } from '../src/modules/brief/constants.js';
import {
  LocalComponents,
  computeFingerprint,
  describeMoved,
  localComponents,
  parseStoredFingerprint,
  remoteComponents,
  serializeFingerprint,
  type FingerprintInput,
} from '../src/modules/brief/fingerprint.js';

/**
 * L05 fingerprint — REQ-8's ten components, split local / remote (D-1a).
 *
 * The file's job is D-1's argument, made mechanical: **the head sha alone is
 * not the state of a brief.** Five things can move with the head untouched, and
 * all five must move the fingerprint. Two of them move only the `remote` half —
 * they are named as such in their own test titles, and in the summary test at
 * the end of this file, because that is precisely the pair the read path cannot
 * see (D-1a) and the reason the card offers regenerate on a brief that reads as
 * current (F-9).
 */

const ISSUE_BODY = 'Rate limiting must apply per workspace, not per process.';
const DOC_BODY = '# Plan\n\nStep 1: add the column. Step 2: backfill nothing.';

/** The baseline state. Every case below changes exactly one thing about it. */
function base(): FingerprintInput {
  return {
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    intent: { derived_at: '2026-08-27T10:00:00.000Z', model: 'openai/gpt-4.1-mini' },
    blast: { indexed_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', state: 'ok' },
    model: { provider: 'openai', model: 'gpt-4.1' },
    assemblerVersion: ASSEMBLER_VERSION,
    issue: { number: 482, state: 'open', title: 'Rate limit per workspace', body: ISSUE_BODY },
    documents: [{ source: 'docs/plans/rate-limit.md', content: DOC_BODY }],
  };
}

const BASE = computeFingerprint(base());

describe('computeFingerprint — stability', () => {
  it('the same inputs give the same digest', () => {
    expect(computeFingerprint(base())).toEqual(BASE);
  });

  it('key order is irrelevant — a fingerprint is over values, not over a literal', () => {
    const b = base();
    const reordered: FingerprintInput = {
      documents: b.documents,
      issue: b.issue,
      assemblerVersion: b.assemblerVersion,
      model: b.model,
      blast: b.blast,
      intent: b.intent,
      headSha: b.headSha,
    };
    expect(computeFingerprint(reordered)).toEqual(BASE);
  });

  it('document order is irrelevant — the same set of documents is the same state', () => {
    const b = base();
    const two = {
      ...b,
      documents: [
        { source: 'docs/plans/a.md', content: 'A' },
        { source: 'docs/plans/b.md', content: 'B' },
      ],
    };
    const swapped = { ...two, documents: [...two.documents].reverse() };
    expect(computeFingerprint(swapped)).toEqual(computeFingerprint(two));
  });

  it('both halves are full-length sha-256 hex', () => {
    expect(BASE.local).toMatch(/^[0-9a-f]{64}$/);
    expect(BASE.remote).toMatch(/^[0-9a-f]{64}$/);
    expect(BASE.local).not.toBe(BASE.remote);
  });
});

describe('AC-19 — the head moves', () => {
  it('a new head sha moves the LOCAL half', () => {
    const moved = computeFingerprint({ ...base(), headSha: 'c'.repeat(40) });
    expect(moved.local).not.toBe(BASE.local);
    expect(moved.remote).toBe(BASE.remote);
    expect(describeMoved(localComponents(base()), localComponents({ ...base(), headSha: 'c'.repeat(40) }))).toEqual(
      ['head_sha'],
    );
  });
});

/**
 * AC-20 — five ways for a brief to go stale with the head UNTOUCHED. Each is
 * its own assertion, because "the fingerprint changed" is only interesting if
 * you know which of the five moved it, and because two of them move a half the
 * read path never recomputes.
 */
describe('AC-20 — five unchanged-head cases, each its own assertion', () => {
  it('(1) intent was re-derived → LOCAL moves, and is read-detectable', () => {
    const current = { ...base(), intent: { derived_at: '2026-08-27T12:00:00.000Z', model: 'openai/gpt-4.1-mini' } };
    const fp = computeFingerprint(current);

    expect(fp.local).not.toBe(BASE.local);
    expect(fp.remote).toBe(BASE.remote);
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'intent_derived_at',
    ]);
  });

  it('(2) indexed_sha moved → LOCAL moves, and is read-detectable', () => {
    const current = { ...base(), blast: { indexed_sha: 'd'.repeat(40), state: 'ok' } };
    const fp = computeFingerprint(current);

    expect(fp.local).not.toBe(BASE.local);
    expect(fp.remote).toBe(BASE.remote);
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'indexed_sha',
    ]);
  });

  it('(3) the linked issue body was edited → REMOTE moves; the read path CANNOT see it', () => {
    const current = {
      ...base(),
      issue: { number: 482, state: 'open', title: 'Rate limit per workspace', body: `${ISSUE_BODY} And per repository.` },
    };
    const fp = computeFingerprint(current);

    expect(fp.remote).not.toBe(BASE.remote);
    // The local half is byte-identical, which is the D-1a trade stated as an
    // assertion: this edit is caught at the next ASSEMBLY, never on read.
    expect(fp.local).toBe(BASE.local);
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([]);
  });

  it('(4) a referenced document was edited → REMOTE moves; the read path CANNOT see it', () => {
    const current = {
      ...base(),
      documents: [{ source: 'docs/plans/rate-limit.md', content: `${DOC_BODY}\nStep 3: backfill after all.` }],
    };
    const fp = computeFingerprint(current);

    expect(fp.remote).not.toBe(BASE.remote);
    expect(fp.local).toBe(BASE.local);
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([]);
  });

  it('(5) the feature model changed → LOCAL moves, and is read-detectable', () => {
    const current = { ...base(), model: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' } };
    const fp = computeFingerprint(current);

    expect(fp.local).not.toBe(BASE.local);
    expect(fp.remote).toBe(BASE.remote);
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'model_provider',
      'model_id',
    ]);
  });

  it('records explicitly WHICH TWO of the five move only the remote half', () => {
    const localMovers: Record<string, boolean> = {};
    const cases: [string, FingerprintInput][] = [
      ['intent re-derived', { ...base(), intent: { derived_at: '2026-08-27T12:00:00.000Z', model: 'openai/gpt-4.1-mini' } }],
      ['indexed_sha moved', { ...base(), blast: { indexed_sha: 'd'.repeat(40), state: 'ok' } }],
      ['linked issue edited', { ...base(), issue: { ...base().issue!, body: 'edited' } }],
      ['referenced document edited', { ...base(), documents: [{ source: 'docs/plans/rate-limit.md', content: 'edited' }] }],
      ['feature model changed', { ...base(), model: { provider: 'openrouter', model: 'x/y' } }],
    ];

    for (const [name, input] of cases) {
      const fp = computeFingerprint(input);
      // All five move the fingerprint. That is REQ-8 in one line.
      expect(fp, name).not.toEqual(BASE);
      localMovers[name] = fp.local !== BASE.local;
    }

    // …and exactly these two are invisible to the read path (D-1a).
    expect(
      Object.entries(localMovers)
        .filter(([, movesLocal]) => !movesLocal)
        .map(([name]) => name),
    ).toEqual(['linked issue edited', 'referenced document edited']);
  });
});

describe('the other local components', () => {
  it('a partial index is a different state from a complete one', () => {
    const current = { ...base(), blast: { indexed_sha: base().blast!.indexed_sha, state: 'partial' } };
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'blast_state',
    ]);
    expect(computeFingerprint(current).local).not.toBe(BASE.local);
  });

  it('a different intent model is a different intent', () => {
    const current = { ...base(), intent: { derived_at: base().intent!.derived_at, model: 'openai/gpt-5-nano' } };
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'intent_model',
    ]);
  });

  it('bumping the assembler version marks every stored brief out of date', () => {
    const current = { ...base(), assemblerVersion: 'brief-assembler/999' };
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'assembler_version',
    ]);
    expect(computeFingerprint(current).local).not.toBe(BASE.local);
  });

  it('an absent input is a distinct state, not the same as a present one', () => {
    expect(computeFingerprint({ ...base(), intent: null }).local).not.toBe(BASE.local);
    expect(computeFingerprint({ ...base(), blast: null }).local).not.toBe(BASE.local);
    expect(computeFingerprint({ ...base(), issue: null }).remote).not.toBe(BASE.remote);
    expect(computeFingerprint({ ...base(), documents: [] }).remote).not.toBe(BASE.remote);
  });
});

describe('describeMoved — REQ-14 marker', () => {
  it('names nothing when nothing moved', () => {
    expect(describeMoved(localComponents(base()), localComponents(base()))).toEqual([]);
  });

  it('names several movers in MovedInput’s declared order, not discovery order', () => {
    const current = {
      ...base(),
      model: { provider: 'openrouter', model: 'x/y' },
      headSha: 'e'.repeat(40),
      blast: { indexed_sha: 'f'.repeat(40), state: 'ok' },
    };
    expect(describeMoved(localComponents(base()), localComponents(current))).toEqual([
      'head_sha',
      'indexed_sha',
      'model_provider',
      'model_id',
    ]);
  });

  it('can only ever name a LOCAL component — the vocabulary is exhaustive over the local half', () => {
    // Enforced mechanically rather than by comment: extending one without the
    // other fails here instead of producing a marker nobody can name.
    expect(Object.keys(LocalComponents.shape).sort()).toEqual([...MovedInput.options].sort());
  });
});

describe('leak guard — components carry digests, never content', () => {
  it('no component contains the issue text or the document text', () => {
    const input = base();
    const serialized = JSON.stringify({
      local: localComponents(input),
      remote: remoteComponents(input),
      fingerprint: computeFingerprint(input),
    });

    expect(serialized).not.toContain(ISSUE_BODY);
    expect(serialized).not.toContain('Rate limit per workspace'); // the issue TITLE
    expect(serialized).not.toContain('backfill');
    expect(serialized).not.toContain(DOC_BODY);
  });

  it('the remote half carries identifiers plus a 12-hex digest, and nothing else', () => {
    const remote = remoteComponents(base());
    expect(remote.linked_issue).toMatch(/^#482\|open\|[0-9a-f]{12}$/);
    expect(remote.documents).toMatch(/^docs\/plans\/rate-limit\.md\|[0-9a-f]{12}$/);
  });

  it('the local half carries only identifiers, timestamps and our own versions', () => {
    expect(localComponents(base())).toEqual({
      head_sha: 'a'.repeat(40),
      intent_derived_at: '2026-08-27T10:00:00.000Z',
      intent_model: 'openai/gpt-4.1-mini',
      indexed_sha: 'b'.repeat(40),
      blast_state: 'ok',
      model_provider: 'openai',
      model_id: 'gpt-4.1',
      assembler_version: ASSEMBLER_VERSION,
    });
  });
});

describe('storage round-trip', () => {
  it('serialises both halves plus the local components into one text column', () => {
    const input = base();
    const raw = serializeFingerprint(computeFingerprint(input), localComponents(input));
    const parsed = parseStoredFingerprint(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.local).toBe(BASE.local);
    expect(parsed!.remote).toBe(BASE.remote);
    // The record is what makes REQ-14 answerable: a digest can only say that
    // SOMETHING moved.
    expect(describeMoved(parsed!.local_components, localComponents({ ...input, headSha: 'z'.repeat(40) }))).toEqual([
      'head_sha',
    ]);
  });

  it('returns null for anything unreadable rather than throwing', () => {
    // A row written before this feature must render as a brief that cannot
    // prove its freshness — not as a 500.
    expect(parseStoredFingerprint(null)).toBeNull();
    expect(parseStoredFingerprint('')).toBeNull();
    expect(parseStoredFingerprint('not json')).toBeNull();
    expect(parseStoredFingerprint('{"local":"a"}')).toBeNull();
  });
});
