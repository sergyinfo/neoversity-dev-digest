import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * No-DB route smoke tests via app.inject(). `/health` and the validation/error
 * envelope don't touch the database (postgres-js connects lazily), so these run
 * without Docker. DB-backed routes are covered in integration.test.ts.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('routes (no DB)', () => {
  it('GET /health → ok', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('POST /settings/test-connection (github) returns structured ConnTestResult', async () => {
    const app = await buildApp({
      config,
      overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'github' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('github');
    expect(body.ok).toBe(true);
    expect(body.message).toContain('octocat');
    await app.close();
  });

  it('POST /settings/test-connection (openai) uses injected LLM listModels', async () => {
    const app = await buildApp({
      config,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { models: [{ id: 'gpt-4.1', provider: 'openai' }] }) },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  /**
   * L05 — the two brief routes are REGISTERED, and their params schema is
   * wired.
   *
   * `hasRoute` proves registration (one import + one entry in
   * `modules/index.ts`); the 422 proves the shared `IdParams` schema really is
   * attached, since a bad uuid must be refused at the edge rather than reaching
   * the handler and becoming a database error. Neither touches the DB, so this
   * stays in the no-Docker suite.
   */
  it('registers GET and POST /pulls/:id/brief with param validation', async () => {
    const app = await buildApp({ config });

    expect(app.hasRoute({ method: 'GET', url: '/pulls/:id/brief' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/pulls/:id/brief' })).toBe(true);

    for (const method of ['GET', 'POST'] as const) {
      const res = await app.inject({ method, url: '/pulls/not-a-uuid/brief' });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }

    await app.close();
  });

  /**
   * L05 (S9) — the project-context module is REGISTERED.
   *
   * `hasRoute` proves the one import + one entry in `modules/index.ts` landed,
   * and the 422s prove the schemas are really attached rather than declared and
   * forgotten. `GET /repos/:id/context` is checked by URL because a shipped
   * client hook (`client/src/lib/hooks/core.ts` `useContextFiles`) has been
   * calling that exact path since part-0 — a near-miss here would look like a
   * working feature and return 404 forever.
   */
  it('registers the project-context routes with param and body validation', async () => {
    const app = await buildApp({ config });

    expect(app.hasRoute({ method: 'GET', url: '/repos/:id/context' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/agents/:id/context/projection' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/context/attachments' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/context/attachments' })).toBe(true);
    expect(app.hasRoute({ method: 'PATCH', url: '/context/attachments/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'DELETE', url: '/context/attachments/:id' })).toBe(true);

    for (const url of ['/repos/not-a-uuid/context', '/agents/not-a-uuid/context/projection']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }

    // AC-5's envelope half: a traversal path is refused at the edge, in the
    // fixed 422 shape, and never reaches a handler that could open it.
    const bad = await app.inject({
      method: 'POST',
      url: '/context/attachments',
      payload: {
        path: '',
        repo_id: 'r1',
        target_kind: 'agent',
        target_id: 'a1',
      },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('validation_error');

    // A target kind outside the closed enum is refused too.
    const kind = await app.inject({
      method: 'GET',
      url: '/context/attachments?target_kind=repo&target_id=x',
    });
    expect(kind.statusCode).toBe(422);

    await app.close();
  });

  it('returns 422 structured error on invalid body', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'not-a-provider' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
