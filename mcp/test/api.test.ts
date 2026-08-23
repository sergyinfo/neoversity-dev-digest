import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, Deadline, apiGet, apiPost } from '../src/api.js';

/**
 * The HTTP client's job is not "fetch"; it is turning every failure into a
 * sentence a model can act on. So the error paths carry most of these tests.
 */

const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<Response> | Response) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiGet / apiPost — happy paths', () => {
  it('returns parsed JSON', async () => {
    mockFetch(() => json([{ id: 'r1' }]));
    await expect(apiGet('/repos')).resolves.toEqual([{ id: 'r1' }]);
  });

  it('handles 204 without trying to parse a body', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(apiGet('/thing')).resolves.toBeUndefined();
  });

  it('POSTs JSON with a content-type', async () => {
    const fn = mockFetch(() => json({ ok: true }));
    await apiPost('/reviews/diff', { repo: 'a/b' });
    const [, init] = fn.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ repo: 'a/b' }));
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});

describe('apiGet — errors are written for the model', () => {
  it('surfaces the API’s structured error envelope, not the status line', async () => {
    mockFetch(() => json({ error: { code: 'not_found', message: 'Agent not found' } }, 404));
    await expect(apiGet('/agents/x')).rejects.toThrow(/Agent not found.*not_found/);
  });

  it('falls back to the status line when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>502</html>', { status: 502 }));
    await expect(apiGet('/repos')).rejects.toThrow(/502/);
  });

  it('tells the user how to start the API when the connection is refused', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(apiGet('/repos')).rejects.toThrow(/cd server && pnpm dev|DEVDIGEST_API_URL/);
  });

  it('distinguishes a timeout from an unreachable server', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    mockFetch(() => Promise.reject(timeout));
    const e: unknown = await apiGet('/repos').then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).message).toMatch(/did not answer within/);
    expect((e as ApiError).message).not.toMatch(/Cannot reach/);
  });

  it('carries the HTTP status on the error', async () => {
    mockFetch(() => json({ error: { code: 'rate_limited', message: 'Slow down' } }, 429));
    const e = (await apiGet('/x').then(() => null, (x: unknown) => x)) as ApiError;
    expect(e.status).toBe(429);
  });
});

describe('Deadline — one budget across a multi-call sequence', () => {
  it('shrinks as time passes and never goes negative', () => {
    const d = new Deadline(50);
    expect(d.remaining()).toBeGreaterThan(0);
    expect(d.expired()).toBe(false);
    expect(new Deadline(0).expired()).toBe(true);
    expect(new Deadline(0).remaining()).toBe(0);
  });

  it('hands a hop the SMALLER of its own limit and what is left', () => {
    const d = new Deadline(1_000);
    // The hop wants 30s but only ~1s of budget remains.
    expect(d.forHop(30_000)).toBeLessThanOrEqual(1_000);
    // The hop wants 10ms and the budget is ample — the hop's own limit wins.
    expect(d.forHop(10)).toBe(10);
  });

  it('never hands out a zero timeout, which would abort instantly', () => {
    expect(new Deadline(0).forHop(5_000)).toBeGreaterThan(0);
  });
});
