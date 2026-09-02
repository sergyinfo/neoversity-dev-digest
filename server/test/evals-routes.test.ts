import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import evalsRoutes from '../src/modules/evals/routes.js';
import { CreateEvalCaseBody, RunEvalBody } from '../src/modules/evals/contract.js';

/**
 * L06 S5 — the seven eval routes, with NO database.
 *
 * Everything asserted here is decided at the edge (param validation, the error
 * envelope, the route's own config) or by a lookup that legitimately returns
 * nothing. SQL correctness lives in `evals.it.test.ts`, per `TESTING.md`.
 *
 * The db is a chainable stub that resolves every query to `[]` — the same
 * "answer no rows" trick `blast-service.test.ts` uses, generalised so the
 * dashboards' longer builder chains work too. A repository that answers "no
 * rows" is exactly what a cross-workspace read looks like, which is the point:
 * the route must turn it into a 404, never a 403.
 */

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Any drizzle builder chain; awaiting any link yields `[]`. */
function emptyDb(): Db {
  const chain: unknown = new Proxy(function noop() {} as object, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
      return () => chain;
    },
    apply: () => chain,
  });
  return chain as Db;
}

const UUID = '11111111-1111-4111-8111-111111111111';
const WS = '22222222-2222-4222-8222-222222222222';

/**
 * `getContext` resolves tenancy through the AuthProvider, and the default
 * `LocalNoAuthProvider` READS the database to find the default workspace — with
 * a stub db that resolves to `[]` it throws, and every handler would 500 before
 * its own lookup ran. Overriding auth is what keeps these assertions about the
 * routes rather than about the fixture.
 */
const auth = {
  currentUser: async () => ({ id: 'user-1', email: 'a@b.c', name: 'Test' }),
  currentWorkspace: async () => ({ id: WS, name: 'default' }),
};

const testApp = () => buildApp({ config, db: emptyDb(), overrides: { auth } });

describe('evals routes — registration and config', () => {
  it('registers all seven routes', async () => {
    const app = await testApp();
    const expected: [string, string][] = [
      ['POST', '/findings/:id/eval-case'],
      ['GET', '/agents/:id/eval-cases'],
      ['DELETE', '/eval-cases/:id'],
      ['POST', '/agents/:id/eval-runs'],
      ['GET', '/agents/:id/eval-runs'],
      ['GET', '/agents/:id/eval-dashboard'],
      ['GET', '/eval-dashboard'],
    ];
    for (const [method, url] of expected) {
      expect(app.hasRoute({ method: method as 'GET', url }), `${method} ${url}`).toBe(true);
    }
    await app.close();
  });

  /**
   * REC-5. `app.ts:95-97` registers `@fastify/rate-limit` only outside `test`,
   * so the override cannot be observed by hammering the route under vitest —
   * asserted structurally instead, via the one hook that sees route options.
   */
  it('rate-limits POST /agents/:id/eval-runs exactly like POST /pulls/:id/review', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('container', { db: emptyDb() } as never);

    const seen: { method: unknown; url: string; config: unknown }[] = [];
    app.addHook('onRoute', (route) => {
      seen.push({ method: route.method, url: route.url, config: route.config });
    });
    await app.register(evalsRoutes);
    await app.ready();

    const run = seen.find((r) => r.url === '/agents/:id/eval-runs' && r.method === 'POST');
    expect(run).toBeDefined();
    expect(run!.config).toMatchObject({ rateLimit: { max: 10, timeWindow: '1 minute' } });

    // The read routes must NOT carry one — they are cheap and the global limit
    // already covers them.
    const list = seen.find((r) => r.url === '/agents/:id/eval-runs' && r.method === 'GET');
    expect((list!.config as { rateLimit?: unknown } | undefined)?.rateLimit).toBeUndefined();
    await app.close();
  });
});

describe('evals routes — validation envelope', () => {
  it('a non-uuid :id is a 422 validation_error on every route that takes one', async () => {
    const app = await testApp();
    const cases: [string, string][] = [
      ['POST', '/findings/not-a-uuid/eval-case'],
      ['GET', '/agents/not-a-uuid/eval-cases'],
      ['DELETE', '/eval-cases/not-a-uuid'],
      ['POST', '/agents/not-a-uuid/eval-runs'],
      ['GET', '/agents/not-a-uuid/eval-runs'],
      ['GET', '/agents/not-a-uuid/eval-dashboard'],
    ];
    for (const [method, url] of cases) {
      const res = await app.inject({ method: method as 'GET', url });
      expect(res.statusCode, `${method} ${url}`).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
      expect(res.json().error.details).toBeDefined();
    }
    await app.close();
  });

  it('a non-uuid agent_id in the body is a 422, not a database error', async () => {
    const app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: `/findings/${UUID}/eval-case`,
      payload: { agent_id: 'nope' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});

describe('evals routes — tenancy is a 404, never a 403', () => {
  it('an agent that is not in this workspace 404s on every agent route', async () => {
    const app = await testApp();
    const cases: [string, string][] = [
      ['GET', `/agents/${UUID}/eval-cases`],
      ['POST', `/agents/${UUID}/eval-runs`],
      ['GET', `/agents/${UUID}/eval-runs`],
      ['GET', `/agents/${UUID}/eval-dashboard`],
    ];
    for (const [method, url] of cases) {
      const res = await app.inject({ method: method as 'GET', url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('not_found');
      // A 403 would confirm the agent exists somewhere.
      expect(res.statusCode).not.toBe(403);
    }
    await app.close();
  });

  it('a finding that is not in this workspace 404s', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'POST', url: `/findings/${UUID}/eval-case` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });

  it('deleting someone else’s eval case 404s', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'DELETE', url: `/eval-cases/${UUID}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('evals request bodies (Sec-2)', () => {
  it('CreateEvalCaseBody carries no expected_output — a client cannot author an expectation', () => {
    const parsed = CreateEvalCaseBody.parse({
      agent_id: UUID,
      expected_output: { expectations: [{ kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 1 }] },
    });
    expect(parsed).toEqual({ agent_id: UUID });
    expect('expected_output' in parsed).toBe(false);
  });

  it('both bodies tolerate a missing payload, so a one-click POST needs no body', () => {
    expect(CreateEvalCaseBody.parse(undefined)).toEqual({});
    expect(CreateEvalCaseBody.parse(null)).toEqual({});
    expect(RunEvalBody.parse(undefined)).toEqual({});
    expect(RunEvalBody.parse({ anything: 1 })).toEqual({});
  });
});
