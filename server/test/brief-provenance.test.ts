import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { GitHubClient, IssueMeta, RepoRef } from '@devdigest/shared';
import { MockGitClient } from '../src/adapters/mocks.js';
import { parseReferences, resolveReferences } from '../src/modules/intent/references.js';
import type { BlastResponse } from '../src/modules/blast/contract.js';
import { BriefProvenance } from '../src/modules/brief/contract.js';
import { assembleBriefInput } from '../src/modules/brief/assemble.js';
import { buildProvenance } from '../src/modules/brief/provenance.js';

/**
 * L05 provenance — REQ-15's record, asserted against planted secrets rather
 * than against its own comment. The shape of this file is deliberately copied
 * from `test/prompt-log.test.ts:8-16`, which does the same job for the review
 * prompt.
 *
 * The pipeline is run for real — `parseReferences` → `resolveReferences` →
 * `assembleBriefInput` → `buildProvenance` — because a leak test that hand-feeds
 * the record only proves the record cannot leak what it was not given.
 */

/** Three planted secrets: one per untrusted source that reaches an assembly. */
const SECRET_IN_PR_BODY = 'PLANTED-SECRET-PR-BODY-NEVER-LOGGED';
const SECRET_IN_ISSUE = 'INTERNAL ONLY: the Q3 pricing model is cost-plus-14pct';
const SECRET_IN_DOCUMENT = 'AKIAPLANDOCUMENTKEY42';

const REPO: RepoRef = { owner: 'acme', name: 'payments-api' };

const PR_BODY = [
  'Implements the plan in docs/plans/rate-limit.md.',
  'Closes #482.',
  'Design notes: https://example.com/design',
  `Deploy note: the staging key is ${SECRET_IN_PR_BODY} — rotate after merge.`,
].join('\n');

const DOCUMENT = `# Rate limit plan\n\nSample credential: ${SECRET_IN_DOCUMENT}\nApply the limiter per workspace.`;

/**
 * A GitHub port that returns a real issue body. The shipped `MockGitHubClient`
 * answers with a fixed `"mock issue"`, which would make the leak assertion
 * vacuous for this source.
 */
const github = {
  async getIssue(_repo: RepoRef, n: number): Promise<IssueMeta> {
    return { number: n, title: 'Rate limit per workspace', body: 'Per process is wrong.', state: 'open' };
  },
} as unknown as GitHubClient;

const BLAST: BlastResponse = {
  pr_id: 'pr-1',
  repo_full_name: 'acme/payments-api',
  head_sha: 'a'.repeat(40),
  indexed_sha: 'b'.repeat(40),
  state: 'ok',
  reason: null,
  counts: { symbols: 1, callers: 1, endpoints: 0, crons: 0 },
  map: {
    changed_symbols: [{ name: 'limiter', file: 'src/middleware/ratelimit.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'limiter',
        callers: [{ name: 'app', file: 'src/app.ts', line: 95 }],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
  },
  prior_prs: [],
};

/**
 * Run the whole assembly the way the service will: the PR body is parsed for
 * references, they are resolved through the shipped guarded resolver with
 * `dropWholeItems: true`, and external fetching is at its shipped default —
 * OFF (`webFetch: null`), which is AC-33's precondition.
 */
async function assemble() {
  const refs = parseReferences(PR_BODY, REPO);
  const { resolved, skipped } = await resolveReferences(refs, {
    repoRef: REPO,
    git: new MockGitClient({ files: { 'docs/plans/rate-limit.md': DOCUMENT } }),
    github,
    webFetch: null,
    dropWholeItems: true,
  });

  const assembly = assembleBriefInput({
    intent: {
      intent: 'Add per-workspace rate limiting.',
      in_scope: ['rate-limiting middleware'],
      out_of_scope: [],
      confidence: 'medium',
      sources: ['pr_description'],
    },
    blast: BLAST,
    stats: { additions: 40, deletions: 4, files_count: 2 },
    files: [
      { path: 'src/middleware/ratelimit.ts', additions: 38, deletions: 2, patch: '@@ -50,2 +50,6 @@' },
      { path: 'src/app.ts', additions: 2, deletions: 2, patch: '@@ -95,2 +95,2 @@' },
    ],
    // The linked issue is a different input from the `#482` reference above,
    // and is where the second planted secret lives.
    issue: { number: 482, title: 'Rate limit per workspace', body: SECRET_IN_ISSUE, state: 'open' },
    references: resolved,
    countTokens: (t) => Math.ceil(t.length / 4),
  });

  const record = buildProvenance({
    assembly,
    blast_state: BLAST.state,
    references_skipped: skipped,
    discarded_refs: 2,
    result: {
      model: 'openai/gpt-4.1',
      tokensIn: 7550,
      tokensOut: 612,
      costUsd: 0.0134,
    },
  });

  return { assembly, record, resolved, skipped };
}

describe('AC-32 — the record carries no input content', () => {
  it('NEVER emits the planted secret from the PR body, the issue or the document', async () => {
    const { record, assembly } = await assemble();
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain(SECRET_IN_PR_BODY);
    expect(serialized).not.toContain(SECRET_IN_ISSUE);
    expect(serialized).not.toContain(SECRET_IN_DOCUMENT);

    // …and the pipeline really did carry all three, so the assertions above
    // are about the record and not about an empty assembly.
    expect(assembly.user).toContain(SECRET_IN_ISSUE);
    expect(assembly.user).toContain(SECRET_IN_DOCUMENT);
    expect(assembly.references_used).toContain('docs/plans/rate-limit.md');
  });

  it('emits no prose from any source, only identifiers and numbers', async () => {
    const { record } = await assemble();
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('Rate limit plan');
    expect(serialized).not.toContain('Apply the limiter per workspace');
    expect(serialized).not.toContain('Per process is wrong');
    expect(serialized).not.toContain('rotate after merge');
    // The derived intent is untrusted prose too.
    expect(serialized).not.toContain('Add per-workspace rate limiting');
    // And no hunk range or diff artefact.
    expect(serialized).not.toContain('@@');
  });

  it('nothing in the record is long enough to be a payload', async () => {
    const { record } = await assemble();
    const strings: string[] = [];
    JSON.parse(JSON.stringify(record), (_k, v) => {
      if (typeof v === 'string') strings.push(v);
      return v;
    });
    for (const s of strings) expect(s.length).toBeLessThanOrEqual(201);
  });

  it('every named REQ-15 field is present', async () => {
    const { record } = await assemble();

    expect(BriefProvenance.safeParse(record).success).toBe(true);
    expect(record.inputs_used).toEqual(['intent', 'blast', 'diff', 'linked_issue', 'references']);
    expect(record.references_used).toEqual(['docs/plans/rate-limit.md', 'acme/payments-api#482']);
    expect(record.references_skipped.length).toBeGreaterThan(0);
    expect(record.dropped_items).toEqual([]);
    expect(record.estimated_input_tokens).toBeGreaterThan(0);
    expect(record.tokens_in).toBe(7550);
    expect(record.tokens_out).toBe(612);
    expect(record.cost_usd).toBe(0.0134);
    expect(record.discarded_refs).toBe(2);
    expect(record.model).toBe('openai/gpt-4.1');
  });

  /**
   * F-6: `inputs_used` records THAT the map contributed and can never say how
   * completely, so the record carries the state it was in and the changed-file
   * coverage separately. Without them a `partial` index is indistinguishable
   * from a complete one in everything downstream of this record.
   */
  it('records how COMPLETE the impact map and the file list were, not just that they were used', async () => {
    const { record, assembly } = await assemble();

    expect(record.inputs_used).toContain('blast');
    expect(record.blast_state).toBe('ok');
    expect(record.changed_files).toEqual({ listed: assembly.files_listed, total: 2 });

    // Still numbers and a fixed label: the safety contract is untouched.
    expect(JSON.stringify(record.changed_files)).not.toMatch(/[a-z]+\.ts/);
  });

  it('records a partial map as partial, where inputs_used cannot tell the two apart', async () => {
    const { assembly } = await assemble();

    const ok = buildProvenance({
      assembly,
      blast_state: 'ok',
      references_skipped: [],
      discarded_refs: 0,
    });
    const partial = buildProvenance({
      assembly,
      blast_state: 'partial',
      references_skipped: [],
      discarded_refs: 0,
    });

    expect(ok.inputs_used).toEqual(partial.inputs_used);
    expect(ok.blast_state).toBe('ok');
    expect(partial.blast_state).toBe('partial');
  });
});

describe('AC-33 — an https reference with external fetching disabled', () => {
  it('is recorded as skipped WITH a reason, and the assembly still completes', async () => {
    const { record, assembly } = await assemble();

    const skipped = record.references_skipped.find((s) => s.source.includes('example.com/design'));
    expect(skipped).toBeDefined();
    // "the fetcher is off" and "the budget ran out" are different answers, and
    // conflating them with "there was nothing to read" is the failure this
    // field exists to prevent.
    expect(skipped!.reason).toBe('external fetching disabled');

    // No outbound call was possible — the port was null — and the brief was
    // still assembled from the four sources that did resolve.
    expect(assembly.user.length).toBeGreaterThan(0);
    expect(record.inputs_used).toContain('references');
  });

  it('a URL identifier is permitted where its CONTENT is not', async () => {
    const { record } = await assemble();
    // The record names WHERE we could not read, which is the whole point of it.
    expect(JSON.stringify(record)).toContain('https://example.com/design');
  });
});

describe('buildProvenance — normalisation', () => {
  const emptyAssembly = {
    system: 's',
    user: 'u',
    estimated_input_tokens: 12.4,
    inputs_used: ['diff', 'intent', 'diff'] as never,
    references_used: ['docs/a.md', 'docs/a.md'],
    dropped_items: [],
    files_listed: 1,
    files_total: 1,
  };

  it('dedupes and orders inputs and references so two records compare byte for byte', () => {
    const record = buildProvenance({
      assembly: emptyAssembly,
      blast_state: 'ok',
      references_skipped: [],
      discarded_refs: 0,
    });
    expect(record.inputs_used).toEqual(['intent', 'diff']);
    expect(record.references_used).toEqual(['docs/a.md']);
    expect(record.estimated_input_tokens).toBe(12);
  });

  it('reports absent provider numbers as null rather than inventing zeros', () => {
    const record = buildProvenance({
      assembly: emptyAssembly,
      blast_state: 'ok',
      references_skipped: [],
      discarded_refs: 0,
      result: null,
    });
    expect(record.tokens_in).toBeNull();
    expect(record.tokens_out).toBeNull();
    expect(record.cost_usd).toBeNull();
    expect(record.model).toBeNull();
  });

  it('keeps a genuine zero cost distinguishable from an unknown one', () => {
    const priced = buildProvenance({
      assembly: emptyAssembly,
      blast_state: 'ok',
      references_skipped: [],
      discarded_refs: 0,
      result: { costUsd: 0, tokensIn: 0, tokensOut: 0, model: 'm' },
    });
    expect(priced.cost_usd).toBe(0);
    expect(priced.tokens_in).toBe(0);
  });

  it('clamps a source long enough to be a payload instead of recording it', () => {
    const record = buildProvenance({
      assembly: emptyAssembly,
      blast_state: 'ok',
      references_skipped: [{ source: 'x'.repeat(5_000), reason: 'y'.repeat(5_000) }],
      discarded_refs: 0,
    });
    expect(record.references_skipped[0]!.source.length).toBeLessThanOrEqual(201);
    expect(record.references_skipped[0]!.reason.length).toBeLessThanOrEqual(161);
  });
});

describe('the safety contract is structural, not just documented', () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL('../src/modules/brief/provenance.ts', import.meta.url)),
    'utf8',
  );
  const body = SOURCE.slice(SOURCE.indexOf('import '));

  it('no code path reads a resolved reference’s content', () => {
    // The module takes `references_used: readonly string[]`, so there is no
    // `.content` to reach — this asserts that stays true.
    expect(body).not.toMatch(/\.content\b/);
    expect(body).not.toContain('ResolvedReference');
  });

  it('has no verbosity level that could turn content on', () => {
    expect(body).not.toMatch(/\bverbose\b/);
  });

  it('never reads the assembled messages themselves', () => {
    expect(body).not.toMatch(/assembly\.(user|system)\b/);
  });
});
