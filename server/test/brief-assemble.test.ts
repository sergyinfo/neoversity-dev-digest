import { describe, it, expect } from 'vitest';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import type { BlastResponse } from '../src/modules/blast/contract.js';
import type { ResolvedReference } from '../src/modules/intent/references.js';
import {
  assembleBriefInput,
  hunkRanges,
  type AssembleInput,
  type BriefChangedFile,
} from '../src/modules/brief/assemble.js';
import {
  BRIEF_SYSTEM_PROMPT,
  MAX_BLAST_SYMBOLS,
  MAX_FILES_LISTED,
  TOKEN_BUDGET,
} from '../src/modules/brief/constants.js';

/**
 * L05 assembly — REQ-3's header-only guarantee, REQ-4's budget and REQ-5's
 * whole-item drops.
 *
 * Two of the tests here are the feature's load-bearing safety assertions:
 * the sentinel (no source line ever leaves the assembler) and the changed-files
 * block scan (nor does any `+`/`-` line, sentinel or not).
 */

/** AC-6's sentinel, plus the trailing function signature git writes after `@@`. */
const SENTINEL = '+const SENTINEL_DO_NOT_SEND = 1;';
const CONFIG_PATCH = `@@ -10,3 +10,4 @@ export function chargeCard(token: string) {
   port: 3000,
${SENTINEL}
-  const legacyKey = "sk_live_dead";
   redisUrl: x,
@@ -44,2 +44,6 @@
   const users = await db.users.findMany();
+  for (const u of users) {}`;

const FILES: BriefChangedFile[] = [
  { path: 'src/config.ts', additions: 2, deletions: 1, patch: CONFIG_PATCH },
  { path: 'src/api/users.ts', additions: 4, deletions: 0, patch: '@@ -1 +1,4 @@\n+x' },
  { path: 'assets/logo.png', additions: 0, deletions: 0, patch: null },
];

const BLAST: BlastResponse = {
  pr_id: 'pr-1',
  repo_full_name: 'acme/web',
  head_sha: 'a'.repeat(40),
  indexed_sha: 'b'.repeat(40),
  state: 'ok',
  reason: null,
  counts: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  map: {
    changed_symbols: [{ name: 'loadConfig', file: 'src/config.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'loadConfig',
        callers: [{ name: 'bootstrap', file: 'src/server.ts', line: 12 }],
        endpoints_affected: ['GET /pulls/:id'],
        crons_affected: [],
      },
    ],
  },
  prior_prs: [],
};

const DOC: ResolvedReference = {
  kind: 'repo-file',
  source: 'docs/plans/rate-limit.md',
  content: '# Rate limit plan\n\nApply the limiter per workspace.',
};

function input(over: Partial<AssembleInput> = {}): AssembleInput {
  return {
    intent: {
      intent: 'Add per-workspace rate limiting.',
      in_scope: ['rate-limiting middleware'],
      out_of_scope: ['billing'],
      confidence: 'medium',
      sources: ['pr_description'],
    },
    blast: BLAST,
    stats: { additions: 6, deletions: 1, files_count: FILES.length },
    files: FILES,
    issue: { number: 482, title: 'Rate limit per workspace', body: 'Per process is wrong.', state: 'open' },
    references: [DOC],
    countTokens: (t) => Math.ceil(t.length / 4),
    ...over,
  };
}

/** The text inside one `<untrusted source="…">` fence. */
function untrustedBlock(user: string, label: string): string {
  const open = `<untrusted source="${label}">\n`;
  const start = user.indexOf(open);
  expect(start, `missing untrusted block ${label}`).toBeGreaterThan(-1);
  const from = start + open.length;
  return user.slice(from, user.indexOf('\n</untrusted>', from));
}

describe('hunkRanges — REQ-3 at its single enforcement point', () => {
  it('returns ranges only, re-rendered from the captured numbers', () => {
    expect(hunkRanges(CONFIG_PATCH)).toEqual(['@@ -10,3 +10,4 @@', '@@ -44,2 +44,6 @@']);
  });

  it('drops the enclosing function signature git appends after the closing @@', () => {
    // This is source CODE on a header line. Substring-matching the header and
    // keeping the line would leak it; re-rendering the four numbers cannot.
    expect(hunkRanges(CONFIG_PATCH).join(' ')).not.toContain('chargeCard');
  });

  it('defaults an omitted length to 1, and ignores anything that is not a header', () => {
    expect(hunkRanges('@@ -5 +7 @@\n+const x = leaked;')).toEqual(['@@ -5,1 +7,1 @@']);
    expect(hunkRanges(null)).toEqual([]);
    expect(hunkRanges('')).toEqual([]);
    expect(hunkRanges('  @@ -1,1 +1,1 @@ indented, not a header')).toEqual([]);
  });
});

describe('AC-6 — no source line reaches the model input', () => {
  const { user } = assembleBriefInput(input());

  it('the sentinel is absent while the file path and its @@ range are present', () => {
    expect(user).not.toContain('SENTINEL_DO_NOT_SEND');
    expect(user).toContain('src/config.ts');
    expect(user).toContain('@@ -10,3 +10,4 @@');
    expect(user).toContain('@@ -44,2 +44,6 @@');
  });

  it('no added, removed or context line survives — not just the sentinel', () => {
    expect(user).not.toContain('sk_live_dead');
    expect(user).not.toContain('db.users.findMany');
    expect(user).not.toContain('port: 3000');
    expect(user).not.toContain('chargeCard');
  });

  it('the changed-files block contains no + or - prefixed line at all', () => {
    // Scoped to that block on purpose: a referenced markdown document may
    // legitimately contain "- bullet" lines, and REQ-3 is about the DIFF.
    const block = untrustedBlock(user, 'changed-files');
    const offenders = block.split('\n').filter((l) => /^[+-]/.test(l));
    expect(offenders).toEqual([]);
  });

  it('a file with no stored patch is still listed, just without ranges', () => {
    expect(user).toContain('assets/logo.png (+0/-0)');
  });
});

describe('untrusted fencing', () => {
  const { user, system } = assembleBriefInput(input());

  it('fences every third-party item under its own source label', () => {
    for (const label of ['pr-intent', 'changed-files', 'blast-map', 'linked-issue', `spec:${DOC.source}`]) {
      expect(user).toContain(`<untrusted source="${label}">`);
    }
  });

  it('the system prompt says instructions inside a fence are never followed', () => {
    expect(system).toBe(BRIEF_SYSTEM_PROMPT);
    expect(system).toContain('UNTRUSTED DATA');
    expect(system).toContain('never an instruction');
  });

  it('records exactly REQ-2’s five sources — the PR body is not a sixth', () => {
    expect(assembleBriefInput(input()).inputs_used).toEqual([
      'intent',
      'blast',
      'diff',
      'linked_issue',
      'references',
    ]);
  });
});

describe('AC-7 — the estimate is the tokenizer’s count of system + user', () => {
  it('records exactly cl100k_base(system + user), under the 8 000 budget', () => {
    // The shipped counter, not the heuristic: REQ-4 fixes the UNIT, and a test
    // that used chars/4 here would not be testing the unit at all.
    const tokenizer = new TiktokenTokenizer();
    const assembled = assembleBriefInput(input({ countTokens: (t) => tokenizer.count(t) }));

    expect(assembled.estimated_input_tokens).toBe(
      tokenizer.count(assembled.system + assembled.user),
    );
    expect(assembled.estimated_input_tokens).toBeLessThanOrEqual(TOKEN_BUDGET);
    expect(assembled.estimated_input_tokens).toBeGreaterThan(0);
  });
});

describe('AC-8 — a failing tokenizer degrades the estimate, never the assembly', () => {
  const failing = () => {
    throw new Error('BPE ranks failed to load');
  };

  it('falls back to ceil(chars/4) and still completes', () => {
    const assembled = assembleBriefInput(input({ countTokens: failing }));

    expect(assembled.estimated_input_tokens).toBe(
      Math.ceil((assembled.system + assembled.user).length / 4),
    );
    expect(assembled.user).toContain('src/config.ts');
    expect(assembled.inputs_used).toContain('diff');
  });

  it('falls back when no counter is injected at all, and when one answers nonsense', () => {
    const none = assembleBriefInput(input({ countTokens: undefined }));
    expect(none.estimated_input_tokens).toBe(Math.ceil((none.system + none.user).length / 4));

    const nonsense = assembleBriefInput(input({ countTokens: () => Number.NaN }));
    expect(nonsense.estimated_input_tokens).toBe(
      Math.ceil((nonsense.system + nonsense.user).length / 4),
    );
  });
});

describe('AC-10 — 300 changed files', () => {
  const many: BriefChangedFile[] = Array.from({ length: 300 }, (_, i) => ({
    path: `src/generated/file-${String(i).padStart(3, '0')}.ts`,
    additions: 1,
    deletions: 0,
    patch: '@@ -1,1 +1,2 @@',
  }));
  const assembled = assembleBriefInput(
    input({ files: many, stats: { additions: 300, deletions: 0, files_count: 300 } }),
  );

  it('lists at most 60 entries', () => {
    expect(assembled.files_listed).toBeLessThanOrEqual(MAX_FILES_LISTED);
    const block = untrustedBlock(assembled.user, 'changed-files');
    const listed = block.split('\n').filter((l) => l.startsWith('src/generated/'));
    expect(listed).toHaveLength(MAX_FILES_LISTED);
  });

  it('records the omission by source, and says so in the input as well', () => {
    expect(assembled.dropped_items).toContainEqual({
      source: 'changed-files',
      reason: `capped at the first ${MAX_FILES_LISTED} of 300 changed files`,
    });
    expect(assembled.user).toContain('…and 240 more changed file(s), not listed');
  });

  it('the cap is the head of the list, not a sample — the allow-list must be predictable', () => {
    expect(assembled.user).toContain('src/generated/file-059.ts');
    expect(assembled.user).not.toContain('src/generated/file-060.ts');
  });

  /**
   * Spec §6: "a risk in file 61 can never be named, and the card says the file
   * list was capped". `files_listed` alone cannot say that — 60 of 60 and 60 of
   * 300 are the same number — so the assembler returns the denominator it
   * already computed for its own "…and N more" line, rather than leaving the
   * caller to derive a second one that could disagree with the prompt.
   */
  it('returns the denominator the prompt used, so the capped state is visible downstream', () => {
    expect(assembled.files_listed).toBe(MAX_FILES_LISTED);
    expect(assembled.files_total).toBe(300);
    expect(assembled.files_total - assembled.files_listed).toBe(240);
  });

  it('reports no cap when every changed file was listed', () => {
    const all = assembleBriefInput(input());
    expect(all.files_listed).toBe(FILES.length);
    expect(all.files_total).toBe(FILES.length);
  });

  it('never reports fewer files than it listed, even on a stale files_count', () => {
    // `pull_requests.files_count` is refreshed by `GET /pulls/:id` and the
    // stored `pr_files` rows are not always the same generation, so a
    // denominator smaller than what was listed is reachable — and would make
    // the coverage read as negative.
    const stale = assembleBriefInput(
      input({ stats: { additions: 6, deletions: 1, files_count: 1 } }),
    );
    expect(stale.files_total).toBe(stale.files_listed);
  });
});

describe('REQ-5 — whole items are dropped in D-8’s order', () => {
  const docs: ResolvedReference[] = [
    { kind: 'repo-file', source: 'docs/plans/a.md', content: 'AAA plan body' },
    { kind: 'github', source: 'acme/web#41', content: 'BBB issue body' },
    { kind: 'url', source: 'https://example.com/spec', content: 'CCC external body' },
  ];
  const symbols: BlastResponse['map']['downstream'] = [
    { symbol: 'topRanked', callers: [{ name: 'a', file: 'src/a.ts', line: 1 }, { name: 'b', file: 'src/b.ts', line: 2 }], endpoints_affected: [], crons_affected: [] },
    { symbol: 'middle', callers: [{ name: 'c', file: 'src/c.ts', line: 3 }], endpoints_affected: [], crons_affected: [] },
    { symbol: 'lowest', callers: [], endpoints_affected: ['GET /x'], crons_affected: [] },
  ];
  const over: Partial<AssembleInput> = {
    references: docs,
    blast: { ...BLAST, map: { ...BLAST.map, downstream: symbols } },
  };

  it('drops references → linked issue → symbols → files, and never empties the last two', () => {
    // A counter that can never be satisfied drives the loop to exhaustion, so
    // the whole order is observable in one deterministic list.
    const assembled = assembleBriefInput(input({ ...over, countTokens: () => 1_000_000 }));

    expect(assembled.dropped_items.map((d) => d.source)).toEqual([
      // references, from the END: least trustworthy resolved last, dropped first
      'https://example.com/spec',
      'acme/web#41',
      'docs/plans/a.md',
      'linked-issue #482',
      // symbols, lowest-ranked first, stopping at the highest-ranked
      'blast-symbol lowest',
      'blast-symbol middle',
      // changed files last — they are the grounding allow-list
      'assets/logo.png',
      'src/api/users.ts',
    ]);

    // Floors: one symbol and one file always survive. A map rendered with no
    // symbols reads as "this change reaches nothing"; an empty file list means
    // every model reference is discarded.
    expect(assembled.user).toContain('topRanked');
    expect(assembled.user).toContain('src/config.ts');
    expect(assembled.files_listed).toBe(1);
  });

  it('completes rather than failing when everything droppable is gone', () => {
    const assembled = assembleBriefInput(input({ ...over, countTokens: () => 1_000_000 }));
    expect(assembled.estimated_input_tokens).toBeGreaterThan(TOKEN_BUDGET);
    expect(assembled.user.length).toBeGreaterThan(0);
    expect(assembled.inputs_used).toEqual(['intent', 'blast', 'diff']);
  });

  it('no item appears partially — a dropped document is wholly gone, a kept one wholly present', () => {
    // A counter tuned to force exactly one drop.
    const budgetFor = (n: number) => (t: string) => (t.includes('CCC external body') ? n : 10);
    const assembled = assembleBriefInput(
      input({ ...over, countTokens: budgetFor(TOKEN_BUDGET + 1) }),
    );

    expect(assembled.dropped_items.map((d) => d.source)).toEqual(['https://example.com/spec']);
    expect(assembled.user).not.toContain('CCC');
    expect(assembled.user).not.toContain('https://example.com/spec');
    // The two survivors are present in full, not clipped to fit.
    expect(assembled.user).toContain('AAA plan body');
    expect(assembled.user).toContain('BBB issue body');
    expect(assembled.references_used).toEqual(['docs/plans/a.md', 'acme/web#41']);
  });

  it('records the blast renderer’s own 12-symbol cap rather than over-claiming', () => {
    const wide = Array.from({ length: 20 }, (_, i) => ({
      symbol: `sym${i}`,
      callers: [{ name: 'c', file: 'src/c.ts', line: 1 }],
      endpoints_affected: [],
      crons_affected: [],
    }));
    const assembled = assembleBriefInput(
      input({ blast: { ...BLAST, map: { ...BLAST.map, downstream: wide } } }),
    );

    expect(assembled.dropped_items).toContainEqual({
      source: 'blast-map',
      reason: `capped at the ${MAX_BLAST_SYMBOLS} highest-ranked of 20 symbols`,
    });
  });
});

describe('inputs_used reflects what actually reached the model', () => {
  it('an EMPTY blast map still counts as blast — absent is not the same as empty', () => {
    const empty: BlastResponse = {
      ...BLAST,
      counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      map: { changed_symbols: [], downstream: [] },
    };
    expect(assembleBriefInput(input({ blast: empty })).inputs_used).toContain('blast');
  });

  it('omits what is absent, and records nothing for a PR that links nothing', () => {
    const assembled = assembleBriefInput(
      input({ intent: null, blast: null, issue: null, references: [] }),
    );
    expect(assembled.inputs_used).toEqual(['diff']);
    expect(assembled.references_used).toEqual([]);
    expect(assembled.user).not.toContain('<untrusted source="blast-map">');
    expect(assembled.user).not.toContain('<untrusted source="linked-issue">');
  });

  it('carries the diff statistics from pull_requests, which are ours and trusted', () => {
    expect(assembleBriefInput(input()).user).toContain('3 changed file(s), +6/-1 line(s)');
  });
});
