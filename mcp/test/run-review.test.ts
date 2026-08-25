import { describe, it, expect, afterEach, vi } from 'vitest';
import { connect, mockRoutes, textOf, type Routes } from './harness.js';

/**
 * `run_review` is the only tool that spends money, and the only one that has to
 * poll. Three things are pinned here:
 *
 *  1. **The call ORDER.** `GET /pulls/:id` must precede `POST …/review`, or the
 *     executor reviews an EMPTY diff and reports a false "approve / score 100"
 *     (server/INSIGHTS.md, 2026-08-02). This is the regression test for that.
 *  2. **The POST's own `reviews` array is never rendered.** It is a literal `[]`
 *     on every call, so a tool that trusted it would report "no review was
 *     produced" on runs that succeeded.
 *  3. **A timeout says STARTED, not failed.** Abandoning the poll cannot cancel
 *     the run — the executor never observed the request.
 */

const REPOS = [{ id: 'r1', full_name: 'acme/app', name: 'app' }];
const PULLS = [{ id: 'p1', number: 7, title: 'Add rate limiting' }];
const AGENTS = [
  { id: 'a1', name: 'General Reviewer', description: '', provider: 'openrouter', model: 'm', enabled: true, strategy: 'single-pass', repo_intel: true },
  { id: 'a2', name: 'Disabled One', description: '', provider: 'openai', model: 'm', enabled: false, strategy: 'single-pass', repo_intel: true },
];

const STARTED = { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'General Reviewer' }], reviews: [] };
const DONE_RUN = { run_id: 'run1', agent_id: 'a1', agent_name: 'General Reviewer', provider: 'openrouter', model: 'm', status: 'done', error: null, duration_ms: 1000, tokens_in: 1, tokens_out: 1, cost_usd: 0.0061, findings_count: 1, grounding: '1/1 passed', ran_at: null, score: 80, blockers: 0 };
const REVIEW = { id: 'rev1', run_id: 'run1', agent_name: 'General Reviewer', verdict: 'request_changes', score: 80, summary: 'One issue found.', findings: [{ id: 'f1', severity: 'WARNING', category: 'bug', title: 'Off by one', file: 'a.ts', start_line: 1, end_line: 1, explanation: '', suggestion: null, confidence: 0.8 }] };

const base = (over: Routes = []): Routes => [
  ...over,
  { match: '/pulls/p1/runs', body: [DONE_RUN] },
  { match: '/pulls/p1/reviews', body: [REVIEW] },
  { match: '/pulls/p1/review', body: STARTED },
  { match: '/pulls/p1', body: { id: 'p1', number: 7, title: 'Add rate limiting' } },
  { match: '/repos/r1/pulls', body: PULLS },
  { match: '/agents', body: AGENTS },
  { match: '/repos', body: REPOS },
];

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEVDIGEST_REVIEW_TIMEOUT_MS;
});

describe('run_review — the mandatory diff warm-up', () => {
  it('calls GET /pulls/:id BEFORE POST /pulls/:id/review', async () => {
    const requests = mockRoutes(base());
    const h = await connect(requests);
    await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' });

    const warm = requests.indexOf('/pulls/p1');
    const post = requests.indexOf('/pulls/p1/review');
    expect(warm).toBeGreaterThanOrEqual(0);
    expect(post).toBeGreaterThanOrEqual(0);
    expect(warm).toBeLessThan(post);
  });
});

describe('run_review — it polls instead of trusting the POST', () => {
  it('renders the verdict, score, tallies and cost from the POLLED result', async () => {
    const h = await connect(mockRoutes(base()));
    const t = textOf(await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' }));

    expect(t).toContain('General Reviewer — request_changes');
    expect(t).toContain('score 80');
    expect(t).toContain('[C0/W1/S0]');
    expect(t).toContain('$0.0061');
    expect(t).toContain('One issue found.');
    // The POST returned `reviews: []`; rendering that would have said this.
    expect(t).not.toMatch(/No review was produced/);
  });

  it('waits while the run is still running, then reports it', async () => {
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body =
          url.includes('/pulls/p1/runs') ? ((polls += 1) < 3 ? [{ ...DONE_RUN, status: 'running' }] : [DONE_RUN])
          : url.includes('/pulls/p1/reviews') ? [REVIEW]
          : url.includes('/pulls/p1/review') ? STARTED
          : url.includes('/repos/r1/pulls') ? PULLS
          : url.includes('/agents') ? AGENTS
          : url.includes('/repos') ? REPOS
          : { id: 'p1', number: 7, title: 'Add rate limiting' };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const h = await connect();
    const t = textOf(await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' }));
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(t).toContain('request_changes');
  });

  it('surfaces a FAILED run with its error rather than dropping it', async () => {
    const h = await connect(
      mockRoutes(
        base([
          { match: '/pulls/p1/runs', body: [{ ...DONE_RUN, status: 'failed', error: 'provider 401' }] },
          { match: '/pulls/p1/reviews', body: [] },
        ]),
      ),
    );
    const t = textOf(await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' }));
    expect(t).toMatch(/run failed: provider 401/);
  });
});

describe('run_review — the timeout message', () => {
  it('says STARTED and points at get_findings; never says "failed"', async () => {
    // A zero budget expires before the first poll.
    process.env.DEVDIGEST_REVIEW_TIMEOUT_MS = '0';
    vi.resetModules();
    const { connect: freshConnect } = await import('./harness.js');
    mockRoutes(base());
    const h = await freshConnect();

    const r = await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' });
    const t = textOf(r);

    expect(r.isError).toBe(true);
    expect(t).toMatch(/WAS STARTED/);
    expect(t).toMatch(/get_findings/);
    expect(t).not.toMatch(/\bfailed\b/i);
  });
});

describe('run_review — guard rails', () => {
  it('refuses a DISABLED agent with a successful, actionable message', async () => {
    const h = await connect(mockRoutes(base()));
    const r = await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'Disabled One' });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/disabled/i);
  });

  it('maps a 429 to an actionable error rather than a raw status', async () => {
    const h = await connect(
      mockRoutes(
        base([
          { match: '/pulls/p1/review', status: 429, body: { error: { code: 'rate_limited', message: 'Too many review runs, retry in a minute' } } },
        ]),
      ),
    );
    const r = await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/retry in a minute/);
  });

  it('reports honestly when no run was started', async () => {
    const h = await connect(
      mockRoutes(base([{ match: '/pulls/p1/review', body: { pr_id: 'p1', runs: [], reviews: [] } }])),
    );
    const t = textOf(await h.call('run_review', { repo: 'acme/app', pr: 7, agent: 'General Reviewer' }));
    expect(t).toMatch(/No run was started/);
    expect(t).toMatch(/list_agents/);
  });
});

describe('run_review — annotations are honest', () => {
  it('is not read-only and not idempotent: it spends money and creates a run', async () => {
    const [clientSide, serverSide] = await import('@modelcontextprotocol/server').then(
      async (m) => {
        const pair = m.InMemoryTransport.createLinkedPair();
        const { createServer } = await import('../src/server.js');
        await createServer().connect(pair[1]);
        return pair;
      },
    );
    const pending = new Map<number, (m: unknown) => void>();
    clientSide.onmessage = (msg) => {
      const m = msg as unknown as { id?: number };
      if (m.id !== undefined) pending.get(m.id)?.(msg);
    };
    await clientSide.start();
    const rpc = <T,>(id: number, method: string, params?: unknown): Promise<T> =>
      new Promise((res) => {
        pending.set(id, res as (m: unknown) => void);
        void clientSide.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as never);
      });
    await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    void clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

    const listed = await rpc<{ result: { tools: { name: string; annotations?: Record<string, boolean> }[] } }>(2, 'tools/list');
    const run = listed.result.tools.find((t) => t.name === 'run_review')!;

    expect(run.annotations?.readOnlyHint).toBe(false);
    expect(run.annotations?.idempotentHint).toBe(false);
    expect(run.annotations?.openWorldHint).toBe(true);
  });
});
