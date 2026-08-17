import { describe, it, expect } from 'vitest';
import { parseReferences, resolveReferences } from '../src/modules/intent/references.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockWebFetchClient,
} from '../src/adapters/mocks.js';

const REPO = { owner: 'acme', name: 'payments-api' };

describe('parseReferences', () => {
  it('extracts repo-file, github and url references', () => {
    const refs = parseReferences(
      [
        'Implements the plan in docs/plans/rate-limit.md.',
        'Closes #482 and relates to https://github.com/other/repo/issues/17.',
        'Design doc: https://notion.so/abc-def',
      ].join('\n'),
      REPO,
    );
    expect(refs.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['repo-file', 'github', 'url']),
    );
    expect(refs.find((r) => r.kind === 'repo-file')?.path).toBe('docs/plans/rate-limit.md');
    const gh = refs.filter((r) => r.kind === 'github');
    expect(gh).toHaveLength(2);
    // A bare #N belongs to THIS repo; a full URL keeps its own owner/repo.
    expect(gh.find((r) => r.issueNumber === 482)).toMatchObject({ owner: 'acme', repo: 'payments-api' });
    expect(gh.find((r) => r.issueNumber === 17)).toMatchObject({ owner: 'other', repo: 'repo' });
    expect(refs.find((r) => r.kind === 'url')?.url).toBe('https://notion.so/abc-def');
  });

  it('does not double-count a github URL as a plain url reference', () => {
    const refs = parseReferences('See https://github.com/acme/payments-api/pull/12', REPO);
    expect(refs.filter((r) => r.kind === 'url')).toHaveLength(0);
    expect(refs.filter((r) => r.kind === 'github')).toHaveLength(1);
  });

  it('rejects traversal, absolute and out-of-allowlist paths', () => {
    const refs = parseReferences(
      [
        'docs/../../../etc/passwd.md',
        '/etc/shadow.md',
        'src/secret.md',
        'C:/windows/system32/plan.md',
      ].join('\n'),
      REPO,
    );
    expect(refs.filter((r) => r.kind === 'repo-file')).toHaveLength(0);
  });

  it('ignores references inside code fences and inline code', () => {
    const refs = parseReferences(
      ['```', '// see #999 and docs/plans/nope.md', '```', 'Inline `#888` too.'].join('\n'),
      REPO,
    );
    expect(refs).toHaveLength(0);
  });

  it('ignores implausible issue numbers', () => {
    expect(parseReferences('colour #0 and id #99999999', REPO)).toHaveLength(0);
  });

  it('de-duplicates and caps per kind', () => {
    const body = [
      ...Array.from({ length: 8 }, (_, i) => `docs/plans/p${i}.md`),
      ...Array.from({ length: 8 }, (_, i) => `#${100 + i}`),
      ...Array.from({ length: 8 }, (_, i) => `https://example.com/${i}`),
      'docs/plans/p0.md', // duplicate
      '#100', // duplicate
    ].join('\n');
    const refs = parseReferences(body, REPO);
    expect(refs.filter((r) => r.kind === 'repo-file')).toHaveLength(5);
    expect(refs.filter((r) => r.kind === 'github')).toHaveLength(5);
    expect(refs.filter((r) => r.kind === 'url')).toHaveLength(3);
  });

  it('returns nothing for an empty body', () => {
    expect(parseReferences(null, REPO)).toEqual([]);
    expect(parseReferences('   ', REPO)).toEqual([]);
  });
});

describe('resolveReferences', () => {
  const deps = (over: Partial<Parameters<typeof resolveReferences>[1]> = {}) => ({
    repoRef: REPO,
    git: new MockGitClient({ files: { 'docs/plans/rate-limit.md': '# Plan\nAdd a token bucket.' } }),
    github: new MockGitHubClient(),
    webFetch: new MockWebFetchClient({ 'https://notion.so/abc': 'external design doc' }),
    ...over,
  });

  it('resolves all three kinds through the injected ports', async () => {
    const refs = parseReferences(
      'Plan: docs/plans/rate-limit.md. Closes #482. Doc: https://notion.so/abc',
      REPO,
    );
    const resolved = await resolveReferences(refs, deps());
    expect(resolved.map((r) => r.kind)).toEqual(['repo-file', 'github', 'url']);
    expect(resolved[0]!.content).toContain('token bucket');
    expect(resolved[1]!.source).toBe('acme/payments-api#482');
    expect(resolved[2]!.content).toBe('external design doc');
  });

  it('orders repo-file and github before external urls', async () => {
    const refs = parseReferences('https://notion.so/abc then docs/plans/rate-limit.md', REPO);
    const resolved = await resolveReferences(refs, deps());
    expect(resolved[0]!.kind).toBe('repo-file');
  });

  it('skips a failing fetch without dropping the others', async () => {
    const refs = parseReferences('docs/plans/missing.md and docs/plans/rate-limit.md', REPO);
    const resolved = await resolveReferences(refs, deps());
    // MockGitClient returns '' for an unknown file → treated as empty, skipped.
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.source).toBe('docs/plans/rate-limit.md');
  });

  it('skips url references when webFetch is unavailable, without throwing', async () => {
    const refs = parseReferences('https://notion.so/abc', REPO);
    await expect(resolveReferences(refs, deps({ webFetch: null }))).resolves.toEqual([]);
  });

  it('skips github references when no PAT is configured', async () => {
    const refs = parseReferences('Closes #482', REPO);
    await expect(resolveReferences(refs, deps({ github: null }))).resolves.toEqual([]);
  });

  it('never lets a throwing port escape', async () => {
    const exploding = {
      fetch: async () => {
        throw new Error('boom');
      },
    };
    const refs = parseReferences('https://notion.so/abc', REPO);
    await expect(resolveReferences(refs, deps({ webFetch: exploding }))).resolves.toEqual([]);
  });

  it('respects the byte budget and logs the truncation', async () => {
    const big = 'y'.repeat(5000);
    const messages: string[] = [];
    const resolved = await resolveReferences(
      parseReferences('docs/plans/big.md', REPO),
      deps({
        git: new MockGitClient({ files: { 'docs/plans/big.md': big } }),
        budgetBytes: 100,
        log: { info: (m) => messages.push(m) },
      }),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.content).toContain('…[truncated]');
    expect(resolved[0]!.content.length).toBeLessThan(200);
    expect(messages.join(' ')).toMatch(/truncated/);
  });

  it('drops later references once the budget is exhausted', async () => {
    const resolved = await resolveReferences(
      parseReferences('docs/plans/a.md and docs/plans/b.md', REPO),
      deps({
        git: new MockGitClient({
          files: { 'docs/plans/a.md': 'x'.repeat(80), 'docs/plans/b.md': 'second' },
        }),
        budgetBytes: 60,
      }),
    );
    expect(resolved).toHaveLength(1);
  });
});
