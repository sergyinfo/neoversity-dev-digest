import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAgent, resolvePr, resolveRepo } from '../src/resolve.js';

/**
 * The resolver is what lets the tool surface speak `owner/name` and PR numbers
 * instead of uuids a model cannot know.
 *
 * Its contract is not just "translate": **every failure must name the valid
 * alternatives**, so a wrong guess costs one retry instead of a dead end. That
 * is what most of this file asserts.
 */

const REPOS = [
  { id: 'r1', full_name: 'acme/payments-api', name: 'payments-api' },
  { id: 'r2', full_name: 'sergyinfo/neoversity-dev-digest', name: 'neoversity-dev-digest' },
];
const PULLS = [
  { id: 'p5', number: 5, title: 'Lesson 3' },
  { id: 'p4', number: 4, title: 'Conventions' },
];
const AGENTS = [
  { id: 'a1', name: 'General Reviewer', enabled: true },
  { id: 'a2', name: 'Security Reviewer', enabled: true },
  { id: 'a3', name: 'Performance Reviewer', enabled: false },
];

/** Route the mocked fetch by path so a test can override one endpoint. */
function route(over: Partial<Record<'repos' | 'pulls' | 'agents', unknown>> = {}) {
  const fn = vi.fn(async (url: string) => {
    const body =
      url.includes('/pulls') ? (over.pulls ?? PULLS)
      : url.includes('/agents') ? (over.agents ?? AGENTS)
      : (over.repos ?? REPOS);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Await a promise that MUST reject, and hand back the error properly typed.
 *
 * `p.catch((e) => e as Error)` types as `T | Error`, which typechecks only
 * because nobody looks — and this package deliberately typechecks its tests.
 */
async function rejection(p: Promise<unknown>): Promise<Error> {
  const resolved = Symbol('resolved');
  const r = await p.then(() => resolved, (e: unknown) => e);
  if (r === resolved) throw new Error('expected a rejection, got a value');
  return r as Error;
}

describe('resolveRepo', () => {
  it('matches the full name, case-insensitively', async () => {
    route();
    await expect(resolveRepo('ACME/Payments-API')).resolves.toMatchObject({ id: 'r1' });
  });

  it('accepts a bare name when it is unambiguous', async () => {
    route();
    await expect(resolveRepo('payments-api')).resolves.toMatchObject({ id: 'r1' });
  });

  it('lists the known repositories when the name is unknown', async () => {
    route();
    await expect(resolveRepo('nope/nope')).rejects.toThrow(
      /acme\/payments-api.*sergyinfo\/neoversity-dev-digest/,
    );
  });

  it('says a bare name is AMBIGUOUS and shows the full names', async () => {
    route({
      repos: [
        { id: 'r1', full_name: 'one/api', name: 'api' },
        { id: 'r2', full_name: 'two/api', name: 'api' },
      ],
    });
    const e = await rejection(resolveRepo('api'));
    expect(e.message).toMatch(/ambiguous/i);
    expect(e.message).toMatch(/one\/api/);
    expect(e.message).toMatch(/two\/api/);
  });

  it('tells the user to import a repo when none exist, instead of "not found"', async () => {
    route({ repos: [] });
    await expect(resolveRepo('anything')).rejects.toThrow(/No repositories are imported/);
  });
});

describe('resolvePr', () => {
  it('resolves by GitHub number and returns a guaranteed id', async () => {
    route();
    const { pr, repo } = await resolvePr('acme/payments-api', 5);
    expect(pr.id).toBe('p5');
    expect(repo.id).toBe('r1');
  });

  it('lists the IMPORTED pr numbers when the number is unknown', async () => {
    route();
    const e = await rejection(resolvePr('acme/payments-api', 999));
    expect(e.message).toMatch(/#5/);
    expect(e.message).toMatch(/#4/);
    expect(e.message).toMatch(/Sync/);
  });

  it('says "(none imported)" rather than an empty list', async () => {
    route({ pulls: [] });
    await expect(resolvePr('acme/payments-api', 1)).rejects.toThrow(/\(none imported\)/);
  });

  it('explains a null id instead of passing "undefined" into a URL', async () => {
    route({ pulls: [{ id: null, number: 7, title: 'unpersisted' }] });
    await expect(resolvePr('acme/payments-api', 7)).rejects.toThrow(/open it once in the web app/i);
  });
});

describe('resolveAgent', () => {
  it('prefers an exact, case-insensitive name match', async () => {
    route();
    await expect(resolveAgent('security reviewer')).resolves.toMatchObject({ id: 'a2' });
  });

  it('accepts a unique substring', async () => {
    route();
    await expect(resolveAgent('Performance')).resolves.toMatchObject({ id: 'a3' });
  });

  it('refuses an ambiguous substring and lists the candidates', async () => {
    route();
    const e = await rejection(resolveAgent('Reviewer'));
    expect(e.message).toMatch(/several/i);
    expect(e.message).toMatch(/General Reviewer/);
    expect(e.message).toMatch(/Security Reviewer/);
  });

  it('lists the configured agents when the name is unknown', async () => {
    route();
    await expect(resolveAgent('Nonexistent')).rejects.toThrow(/General Reviewer/);
  });

  it('resolves a DISABLED agent — enforcement belongs to the caller', async () => {
    // run_review reports "that agent is disabled"; the resolver's job is only to
    // find it. Failing here would produce a misleading "no such agent".
    route();
    await expect(resolveAgent('Performance Reviewer')).resolves.toMatchObject({ enabled: false });
  });
});

describe('the boundary rule: no uuid is ever an INPUT', () => {
  it('every resolver takes human identifiers only', async () => {
    route();
    // Passing the internal id must NOT resolve — that is the point of the rule.
    await expect(resolveRepo('r1')).rejects.toThrow(/not imported/);
  });
});
