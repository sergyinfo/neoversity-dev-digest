import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { AttachmentInput } from '../src/modules/project-context/contract.js';
import {
  MAX_ATTACHMENT_ORDER,
  MAX_ATTACHMENT_PATH_LEN,
} from '../src/modules/project-context/constants.js';

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

    const REPO = '11111111-1111-4111-8111-111111111111';
    const AGENT = '22222222-2222-4222-8222-222222222222';
    const body = (over: Record<string, unknown>) => ({
      path: 'docs/a.md',
      repo_id: REPO,
      target_kind: 'agent',
      target_id: AGENT,
      ...over,
    });
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/context/attachments', payload });
    const envelope = async (res: Awaited<ReturnType<typeof post>>) => {
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
      // The SCHEMA layer, named: `app.ts`'s ZodError branch is the only one that
      // produces this message, so this assertion cannot be satisfied by a
      // handler-thrown `ValidationError` (which carries its own text).
      expect(res.json().error.message).toBe('Request validation failed');
    };

    /**
     * AC-5, the half `AttachmentInput` really owns (fix-brief F7).
     *
     * The empty path IS refused at the edge. A GENUINE traversal path is NOT:
     * `'../../etc/passwd'` satisfies `z.string()` and is refused one layer in,
     * by `attach()`'s `isSafeRelPath` gate — asserted against a live handler,
     * with the layer named, in `project-context.it.test.ts` ("AC-5 — traversal
     * ... never opened"). Every id here is a real uuid so that `path` is the
     * only field under test; before F9 they were `'r1'`/`'a1'` and would now
     * have made this pass for the wrong reason.
     */
    await envelope(await post(body({ path: '' })));

    // A target kind outside the closed enum is refused too.
    const kind = await app.inject({
      method: 'GET',
      url: '/context/attachments?target_kind=repo&target_id=x',
    });
    expect(kind.statusCode).toBe(422);

    /**
     * F9 — id-shaped fields are uuids, per the `IdParams` convention
     * (`_shared/schemas.ts:11`): "an invalid id becomes a clean 422 instead of a
     * downstream DB/500". Without it these strings reach `eq(t.agents.id, id)`
     * against a `uuid` column, Postgres raises 22P02, and `app.ts:160-163`
     * echoes `e.message` — the raw PG text — to the caller as a 500.
     */
    await envelope(await post(body({ repo_id: 'not-a-uuid' })));
    await envelope(await post(body({ target_id: 'not-a-uuid' })));

    for (const url of [
      '/context/attachments?target_kind=agent&target_id=not-a-uuid',
      `/agents/${AGENT}/context/projection?repo_id=not-a-uuid`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
      expect(res.json().error.message).toBe('Request validation failed');
    }

    /**
     * F10 — `path` and `order` carry bounds, so the failure is a 422 at the edge
     * rather than a 500 carrying a raw Postgres message.
     *
     * The precedent is `symbols.name` in the same schema file
     * (`db/schema/context.ts:23-34`): a btree index row over ~2704 bytes is
     * rejected by Postgres outright, and `path` is the third column of
     * `ctx_att_agent_repo_path_uq`. `order` is an `integer` column, so anything
     * past 2^31-1 overflows it. Neither is reachable through the UI; both are
     * reachable through the API.
     */
    await envelope(await post(body({ path: `docs/${'a'.repeat(MAX_ATTACHMENT_PATH_LEN)}.md` })));
    await envelope(await post(body({ order: MAX_ATTACHMENT_ORDER + 1 })));
    await envelope(await post(body({ order: -1 })));
    // ...and the bounds are not so tight that an ordinary attachment trips them.
    expect(AttachmentInput.safeParse(body({ order: MAX_ATTACHMENT_ORDER })).success).toBe(true);
    expect(
      AttachmentInput.safeParse(body({ path: `docs/${'a'.repeat(MAX_ATTACHMENT_PATH_LEN - 9)}.md` }))
        .success,
    ).toBe(true);

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

/**
 * Fix-brief F6 — Project Context is reached through the container, like every
 * other sibling capability, and the slot is injectable.
 *
 * The cost of the old direct `new ProjectContextService(this.container)` in
 * `run-executor` was exactly this seam: a reviews-run test could not stub what
 * an agent's project context resolves to and had to stand up a real clone on
 * disk. Asserting the getter and the override here — with no DB — is what makes
 * that claim mechanical rather than a comment.
 */
describe('container.projectContext (F6)', () => {
  it('exposes a cached getter of the `blast` shape', async () => {
    const app = await buildApp({ config });
    const first = app.container.projectContext;
    expect(first).toBeDefined();
    expect(typeof first.resolveFor).toBe('function');
    // Cached, like `blast` and `repoIntel`: the constructor takes the container
    // and nothing else, so there is no per-request state to pin.
    expect(app.container.projectContext).toBe(first);
    await app.close();
  });

  it('honours a ContainerOverrides stub, so a run can be tested without a clone', async () => {
    const stub = {
      resolveFor: async () => ({
        entries: [],
        texts: ['stubbed'],
        sectionText: '',
        sectionTokens: 42,
        skipped: [],
        dropped: [],
        specsRead: [],
      }),
    };
    const app = await buildApp({ config, overrides: { projectContext: stub } });
    expect(app.container.projectContext).toBe(stub);
    const resolved = await app.container.projectContext.resolveFor('ws', 'agent', {
      id: 'repo',
      clonePath: null,
    });
    expect(resolved.sectionTokens).toBe(42);
    await app.close();
  });
});
