import { describe, it, expect, afterEach, vi } from 'vitest';
import { connect, mockRoutes, textOf, type Routes } from './harness.js';

/**
 * Per-tool behaviour, driven over a real transport so the SDK's generated
 * schemas and argument validation are exercised too.
 *
 * The recurring assertion across all five tools: **an empty result and a
 * failure never look alike**, and every dead end names the way out.
 */

const REPOS = [{ id: 'r1', full_name: 'acme/app', name: 'app' }];
const PULLS = [{ id: 'p1', number: 7, title: 'Add rate limiting' }];
const AGENTS = [
  { id: 'a1', name: 'General Reviewer', description: 'Bugs and clarity', provider: 'openrouter', model: 'deepseek/x', enabled: true, strategy: 'single-pass', repo_intel: true },
  { id: 'a2', name: 'Sleepy Reviewer', description: '', provider: 'openai', model: 'gpt-4.1', enabled: false, strategy: 'single-pass', repo_intel: false },
];

const base = (over: Routes = []): Routes => [
  ...over,
  { match: '/repos/r1/pulls', body: PULLS },
  { match: '/repos/r1/conventions', body: [] },
  { match: '/agents', body: AGENTS },
  { match: '/repos', body: REPOS },
];

afterEach(() => vi.unstubAllGlobals());

const withRoutes = async (routes: Routes) => connect(mockRoutes(routes));

describe('list_agents', () => {
  it('renders provider, model and enabled state', async () => {
    const h = await withRoutes(base());
    const t = textOf(await h.call('list_agents'));
    expect(t).toContain('General Reviewer — openrouter/deepseek/x');
    expect(t).toContain('enabled');
    expect(t).toContain('disabled');
    // The pointer to run_review lives in the tool DESCRIPTION, not in every
    // result: the description is loaded once per session, the result on every
    // call. `context-budget.test.ts` is what guards the description.
  });

  it('filters to enabled agents', async () => {
    const h = await withRoutes(base());
    const t = textOf(await h.call('list_agents', { enabled_only: true }));
    expect(t).toContain('General Reviewer');
    expect(t).not.toContain('Sleepy Reviewer');
  });

  it('an empty roster is a SUCCESS that says how to create one', async () => {
    const h = await withRoutes(base([{ match: '/agents', body: [] }]));
    const r = await h.call('list_agents');
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/create one/i);
  });
});

describe('get_findings', () => {
  const REVIEWS = [
    {
      id: 'rev1',
      run_id: 'run1',
      agent_name: 'General Reviewer',
      verdict: 'request_changes',
      findings: [
        { id: 'f1', severity: 'CRITICAL', category: 'security', title: 'Hardcoded key', file: 'src/a.ts', start_line: 3, end_line: 3, explanation: 'why', suggestion: 'fix', confidence: 0.9 },
        { id: 'f2', severity: 'SUGGESTION', category: 'style', title: 'Rename', file: 'src/b.ts', start_line: 9, end_line: 9, explanation: 'why2', suggestion: null, confidence: 0.4 },
      ],
    },
  ];
  const routes = (over: Routes = []) => base([...over, { match: '/pulls/p1/reviews', body: REVIEWS }]);

  it('sorts by severity and fences the findings as untrusted', async () => {
    const h = await withRoutes(routes());
    const t = textOf(await h.call('get_findings', { repo: 'acme/app', pr: 7 }));
    expect(t.indexOf('CRITICAL')).toBeLessThan(t.indexOf('SUGGESTION'));
    expect(t).toContain('<untrusted source="review-findings">');
    expect(t).toContain('src/a.ts:3');
  });

  it('concise is the default; detailed adds why and fix', async () => {
    const h = await withRoutes(routes());
    const concise = textOf(await h.call('get_findings', { repo: 'acme/app', pr: 7 }));
    const detailed = textOf(
      await h.call('get_findings', { repo: 'acme/app', pr: 7, format: 'detailed' }),
    );
    expect(concise).not.toContain('why:');
    expect(detailed).toContain('why: why');
    expect(detailed).toContain('fix: fix');
    expect(detailed.length).toBeGreaterThan(concise.length);
  });

  it('filters by severity', async () => {
    const h = await withRoutes(routes());
    const t = textOf(await h.call('get_findings', { repo: 'acme/app', pr: 7, severity: 'CRITICAL' }));
    expect(t).toContain('Hardcoded key');
    expect(t).not.toContain('Rename');
  });

  it('distinguishes NEVER REVIEWED from reviewed-and-clean', async () => {
    const never = await withRoutes(routes([{ match: '/pulls/p1/reviews', body: [] }]));
    expect(textOf(await never.call('get_findings', { repo: 'acme/app', pr: 7 }))).toMatch(
      /has not been reviewed yet/,
    );

    const clean = await withRoutes(
      routes([
        { match: '/pulls/p1/reviews', body: [{ id: 'r', run_id: 'x', agent_name: 'General Reviewer', verdict: 'approve', findings: [] }] },
      ]),
    );
    const t = textOf(await clean.call('get_findings', { repo: 'acme/app', pr: 7 }));
    expect(t).toMatch(/No findings/);
    expect(t).toMatch(/approve/);
  });

  it('rejects a missing required argument at the protocol layer', async () => {
    const h = await withRoutes(routes());
    const r = await h.call('get_findings', { repo: 'acme/app' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/pr/);
  });
});

describe('get_conventions', () => {
  const RULES = [
    { id: 'c1', rule: 'Use zod for validation', category: 'validation', evidence_path: 'src/x.ts', start_line: 4, confidence: 0.9, status: 'accepted', accepted: true },
    { id: 'c2', rule: 'Prefer named exports', category: null, evidence_path: 'src/y.ts', start_line: null, confidence: 0.6, status: 'pending', accepted: false },
  ];

  it('returns accepted rules by default, fenced as untrusted', async () => {
    const h = await withRoutes(base([{ match: '/repos/r1/conventions', body: RULES }]));
    const t = textOf(await h.call('get_conventions', { repo: 'acme/app' }));
    expect(t).toContain('<untrusted source="repo-conventions">');
    expect(t).toContain('Use zod for validation');
    expect(t).not.toContain('Prefer named exports');
    expect(t).toContain('src/x.ts:4');
  });

  it('status="all" includes every candidate and labels each', async () => {
    const h = await withRoutes(base([{ match: '/repos/r1/conventions', body: RULES }]));
    const t = textOf(await h.call('get_conventions', { repo: 'acme/app', status: 'all' }));
    expect(t).toContain('(accepted)');
    expect(t).toContain('(pending)');
  });

  it('nothing extracted yet → a success naming the extractor', async () => {
    const h = await withRoutes(base());
    const r = await h.call('get_conventions', { repo: 'acme/app' });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/extractor/i);
  });

  it('nothing at THIS status → the per-status tally, not silence', async () => {
    const h = await withRoutes(base([{ match: '/repos/r1/conventions', body: [RULES[1]] }]));
    const t = textOf(await h.call('get_conventions', { repo: 'acme/app' }));
    expect(t).toMatch(/pending=1/);
    expect(t).toMatch(/status="all"/);
  });
});

describe('get_blast_radius', () => {
  const MAP = {
    pr_id: 'p1',
    repo_full_name: 'acme/app',
    head_sha: 'head111',
    indexed_sha: 'idx222',
    state: 'ok',
    reason: null,
    counts: { symbols: 1, callers: 2, endpoints: 1, crons: 0 },
    map: {
      changed_symbols: [{ name: 'rateLimit', file: 'src/mw.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'rateLimit',
          callers: [
            { name: 'register', file: 'src/api/index.ts', line: 23 },
            { name: 'hook', file: 'src/api/hooks.ts', line: 45 },
          ],
          endpoints_affected: ['GET /items'],
          crons_affected: [],
        },
      ],
    },
    prior_prs: [],
  };
  const routes = (body: unknown) => base([{ match: '/pulls/p1/blast', body }]);

  it('renders symbols, callers and endpoints, and names the indexed revision', async () => {
    const h = await withRoutes(routes(MAP));
    const t = textOf(await h.call('get_blast_radius', { repo: 'acme/app', pr: 7 }));
    expect(t).toContain('rateLimit — 2 caller(s)');
    expect(t).toContain('src/api/index.ts:23');
    expect(t).toContain('reaches GET /items');
    expect(t).toContain('idx222');
  });

  it('degraded is an ERROR saying UNKNOWN — never an empty success', async () => {
    const r = await (
      await withRoutes(
        routes({ ...MAP, state: 'degraded', reason: 'no_data', map: { changed_symbols: [], downstream: [] }, counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 } }),
      )
    ).call('get_blast_radius', { repo: 'acme/app', pr: 7 });

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('UNKNOWN');
    expect(textOf(r)).toMatch(/resync/i);
  });

  it('partial is a SUCCESS whose first line flags the incompleteness', async () => {
    const h = await withRoutes(routes({ ...MAP, state: 'partial', reason: '3 file(s) skipped' }));
    const r = await h.call('get_blast_radius', { repo: 'acme/app', pr: 7 });
    expect(r.isError).toBeUndefined();
    expect(textOf(r).split('\n')[0]).toMatch(/incomplete/i);
  });

  it('an indexed repo with no downstream says so explicitly', async () => {
    const h = await withRoutes(
      routes({ ...MAP, counts: { symbols: 2, callers: 0, endpoints: 0, crons: 0 }, map: { changed_symbols: MAP.map.changed_symbols, downstream: [] } }),
    );
    const r = await h.call('get_blast_radius', { repo: 'acme/app', pr: 7 });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/not missing data/i);
  });
});

describe('every tool: an unreachable API is an actionable isError', () => {
  it.each(['list_agents', 'get_findings', 'get_conventions', 'get_blast_radius'])(
    '%s',
    async (tool) => {
      const h = await withRoutes([
        { match: '/', reject: new TypeError('fetch failed') },
      ]);
      const args = tool === 'list_agents' ? {} : { repo: 'acme/app', pr: 7 };
      const r = await h.call(tool, args);
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/Cannot reach the DevDigest API/);
    },
  );
});
