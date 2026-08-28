import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { BriefResponse } from '../src/modules/brief/contract.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * L05 — the PR Why + Risk Brief, end to end against a real Postgres.
 *
 * ── WHY THIS SUITE RUNS ON `NODE_ENV=development` (plan R3) ────────────────
 *
 * `app.ts:95-97` registers `@fastify/rate-limit` ONLY when `nodeEnv !== 'test'`,
 * so under a test-config app the POST route's 5/min override is inert and
 * AC-24 would pass by never rate-limiting anything. No test in this repository
 * asserted a 429 before this one, and the two pre-existing 5/min overrides
 * (`intent`, `blast/summary`) have therefore never been exercised. The suite
 * runs as `development` with logging silenced, following `intent.it.test.ts`.
 *
 * CONSEQUENCE, and the reason each test builds its OWN app: the limiter's store
 * is per-app and keyed on `req.ip`, which `inject()` fixes at 127.0.0.1. Two
 * tests sharing one app would share one counter, and the fifth POST of the
 * suite would start failing tests that have nothing to do with rate limiting.
 */
const devConfig = () =>
  loadConfig({
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);

/** A `ModelBrief`-shaped fixture: what the stubbed provider "returns". */
const BRIEF_FIXTURE = {
  what: 'Adds a token-bucket rate limiter to the public API routes.',
  why: 'A single client saturated the public endpoints last week.',
  risk_level: 'medium' as const,
  risks: [
    {
      kind: 'behaviour',
      title: 'Limiter rejects legitimate bursts',
      explanation: 'The bucket size is not configurable per route.',
      severity: 'medium' as const,
      file_refs: ['src/middleware/ratelimit.ts'],
    },
  ],
  review_focus: [
    {
      file: 'src/middleware/ratelimit.ts',
      line: 11,
      reason: 'The bucket size is hardcoded here.',
    },
  ],
};

const INTENT_ROW = {
  intent: 'Add rate limiting to the public API endpoints.',
  inScope: ['rate-limiting middleware'],
  outOfScope: ['authentication'],
  confidence: 'high' as const,
  sources: ['pr_description' as const],
};

/** A `full` index state — what `BlastService` needs before it asks for a map. */
function indexState(over: Record<string, unknown> = {}) {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'idx-sha-1',
    indexerVersion: 2,
    updatedAt: new Date(0),
    ...over,
  };
}

const BLAST_RESULT = {
  changedSymbols: [{ file: 'src/middleware/ratelimit.ts', name: 'limiter', kind: 'function' }],
  callers: [
    { file: 'src/server.ts', symbol: 'register', viaSymbol: 'limiter', line: 12, rank: 5 },
  ],
  impactedEndpoints: ['GET /things'],
  factsByFile: { 'src/server.ts': { endpoints: ['GET /things'], crons: [] } },
  degraded: false,
};

/**
 * A repo-intel stub good enough for `BlastService`. Partial on purpose: the
 * facade has 15 methods and blast reads two of them, so stating the two says
 * which ones the brief depends on.
 *
 * `mutable` is read on EVERY call rather than captured, so a test can move
 * `lastIndexedSha` mid-test the way `POST /repos/:id/resync` would.
 */
function stubRepoIntel(
  over: {
    state?: Record<string, unknown>;
    mutable?: Record<string, unknown>;
    blast?: unknown;
  } = {},
) {
  return {
    getIndexState: async () => ({
      ...indexState(),
      ...(over.state ?? {}),
      ...(over.mutable ?? {}),
    }),
    getBlastRadius: async () => over.blast ?? BLAST_RESULT,
    getDependentFiles: async () => [],
    getFileFacts: async () => [],
  } as never;
}

/**
 * A GitHub stub whose issues are read at call time, so a test can edit one and
 * assert the difference between what the READ path can see and what the next
 * ASSEMBLY can (D-1a).
 */
function stubGithub(issues: Record<number, { title: string; body: string; state: string }>) {
  return {
    getIssue: async (_repo: unknown, n: number) => ({
      number: n,
      title: issues[n]?.title ?? `Issue #${n}`,
      body: issues[n]?.body ?? '',
      state: issues[n]?.state ?? 'open',
    }),
    getPullRequest: async () => {
      throw new Error('not a pull request');
    },
  } as never;
}

/**
 * The user messages of every structured call, unescaped.
 *
 * `JSON.stringify(llm.calls)` escapes the quotes inside the prompt, so
 * `<untrusted source="pr-intent">` never matches there — reach for the message
 * itself when the assertion is about what the model was told.
 */
function userInputs(llm: MockLLMProvider): string {
  return llm.calls
    .filter((c) => c.method === 'completeStructured')
    .map((c) => (c.req as { messages: { content: string }[] }).messages[1]?.content ?? '')
    .join('\n');
}

let seq = 0;

d('L05 PR Why + Risk Brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setupPr(
    opts: {
      body?: string | null;
      intent?: boolean;
      headSha?: string;
      files?: { path: string; additions: number; deletions: number; patch: string }[];
      workspaceId?: string;
    } = {},
  ) {
    const db = pg.handle.db;
    const ws = opts.workspaceId ?? workspaceId;
    const name = `payments-api-brief-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: opts.headSha ?? 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: opts.body === undefined ? 'Implements the limiter.' : opts.body,
      })
      .returning();

    const files = opts.files ?? [
      {
        path: 'src/middleware/ratelimit.ts',
        additions: 1,
        deletions: 0,
        patch: '@@ -10,3 +10,4 @@ export function limiter(req) {\n   port: 3000,\n+  limit: 100,\n   redisUrl: x,',
      },
    ];
    if (files.length > 0) {
      await db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));
    }
    if (opts.intent !== false) {
      await db.insert(t.prIntent).values({ prId: pr!.id, ...INTENT_ROW });
    }
    return { repo: repo!, pr: pr! };
  }

  function appWith(
    opts: {
      repoIntel?: unknown;
      files?: Record<string, string>;
      github?: unknown;
      failModel?: boolean;
    } = {},
  ) {
    // Held by reference and looked up per call, so a test can swap the answer
    // between two assemblies without building a second app (and losing the
    // call count that proves how many completions were made).
    const fixtures: Record<string, unknown> = { PrBrief: { ...BRIEF_FIXTURE } };
    const llm = new MockLLMProvider('openai', { structuredBySchema: fixtures });
    if (opts.failModel) {
      llm.completeStructured = async () => {
        throw new Error('provider exploded');
      };
    }
    return {
      llm,
      fixtures,
      app: buildApp({
        config: devConfig(),
        db: pg.handle.db,
        overrides: {
          git: new MockGitClient({ files: opts.files ?? {} }),
          repoIntel: (opts.repoIntel ?? stubRepoIntel()) as never,
          github: opts.github as never,
          // `risk_brief`'s registry default is openai/gpt-4.1.
          llm: { openai: llm },
        },
      }),
    };
  }

  /**
   * AC-24 — written FIRST, before the rest of S12, because this is the only
   * assertion in the repository that depends on the limiter actually being
   * registered. Six POSTs inside one minute; the sixth is refused by the
   * limiter rather than served.
   */
  it('rate-limits the generate route at 5 requests per minute', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await a.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/brief`,
        payload: { regenerate: true },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    // The refused request cost nothing: five assemblies, five model calls.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(5);
    await a.close();
  });

  // ────────────────────────────────────────────── the brief itself ──

  /** AC-1, AC-2 — every field of REQ-1, from exactly one structured call. */
  it('assembles a brief with all five fields from exactly one model call', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json<BriefResponse>();

    expect(body.what.length).toBeGreaterThan(0);
    expect(body.why.length).toBeGreaterThan(0);
    expect(['high', 'medium', 'low']).toContain(body.risk_level);
    expect(body.risks[0]?.title).toBe('Limiter rejects legitimate bursts');
    expect(body.review_focus[0]?.file).toBe('src/middleware/ratelimit.ts');
    expect(body.review_focus[0]?.line).toBe(11);
    expect(body.generated_at).toBeTruthy();
    expect(body.out_of_date).toBe(false);
    expect(body.moved_inputs).toEqual([]);
    expect(body.model).toBe('gpt-4.1');
    expect(body.cost_usd).toBe(0.001);

    // AC-2: exactly ONE structured completion for the whole assembly.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(0);

    // …and it round-trips through `pr_brief` unchanged.
    const get = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.statusCode).toBe(200);
    const stored = get.json<BriefResponse>();
    expect(stored.what).toBe(body.what);
    expect(stored.risks).toEqual(body.risks);
    expect(stored.review_focus).toEqual(body.review_focus);
    expect(stored.state_fingerprint.local).toBe(body.state_fingerprint.local);
    expect(stored.state_fingerprint.remote).toBe(body.state_fingerprint.remote);

    // The column carries the local component RECORD too, which is what lets
    // REQ-14 name the input that moved rather than only that one did.
    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(JSON.parse(row!.stateFingerprint!).local_components.head_sha).toBe('a1b2c3d4');
    await a.close();
  });

  /** AC-3 — a stale intent is read AS IS; the brief never derives one (D-12). */
  it('reads a stale intent as-is, with zero derivation calls', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr();
    // The stored intent was derived against a head this PR has long left.
    await pg.handle.db
      .update(t.prIntent)
      .set({ headSha: 'an-old-head', derivedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(t.prIntent.prId, pr.id));

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);

    // Read as is: the stale text reached the model input…
    const input = userInputs(llm);
    expect(input).toContain('Add rate limiting to the public API endpoints.');
    expect(input).toContain('<untrusted source="pr-intent">');
    // …and NOTHING re-derived it. `getOrCompute` would have, at a second call's
    // cost, and would have overwritten a row the reader can still see is stale.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(JSON.stringify(llm.calls)).not.toContain('PrIntent');
    const [intentRow] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(intentRow!.headSha).toBe('an-old-head');
    await a.close();
  });

  /** AC-4 — a `docs/` plan and a `#123` both reach the input; five sources. */
  it('puts a docs/ plan and a linked issue in the input and records five sources', async () => {
    const issues: Record<number, { title: string; body: string; state: string }> = {
      123: { title: 'Public API keeps falling over', body: 'One client sends 900 rps.', state: 'open' },
    };
    const { app, llm } = appWith({
      files: { 'docs/plans/rate-limit.md': '# Plan\n\nAdd a token bucket to /api/public/*.' },
      github: stubGithub(issues),
    });
    const a = await app;
    const { pr } = await setupPr({
      body: 'Implements docs/plans/rate-limit.md. Closes #123.',
    });

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json<BriefResponse>();

    const input = userInputs(llm);
    expect(input).toContain('token bucket to /api/public/*');
    expect(input).toContain('One client sends 900 rps.');
    expect(body.references_used).toContain('docs/plans/rate-limit.md');

    // All five of REQ-2's sources, and no sixth.
    expect(body.inputs_used).toEqual(['intent', 'blast', 'diff', 'linked_issue', 'references']);
    await a.close();
  });

  /**
   * AC-9 — an over-budget input is brought under 8 000 tokens by dropping WHOLE
   * items, the drops are recorded by source, and the assembly still succeeds.
   */
  it('keeps an over-budget input inside the token budget, dropping whole items', async () => {
    const SENTINEL = 'SENTINEL_MIDDLE_OF_THE_PLAN';
    const bigDoc = `# Plan\n\n${'requirement line that is quite long indeed. '.repeat(100)}\n${SENTINEL}\n${'more requirement prose. '.repeat(100)}`;
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/services/module-${i}/handler.ts`,
      additions: 40,
      deletions: 5,
      patch: Array.from({ length: 40 }, (_, h) => `@@ -${h * 10},4 +${h * 10},6 @@`).join(
        '\n   context\n',
      ),
    }));

    const { app, llm } = appWith({ files: { 'docs/plans/big.md': bigDoc } });
    const a = await app;
    const { pr } = await setupPr({ body: 'See docs/plans/big.md.', files });

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    const provenance = row!.provenance as {
      estimated_input_tokens: number;
      dropped_items: { source: string; reason: string }[];
    };
    expect(provenance.estimated_input_tokens).toBeLessThanOrEqual(8000);
    expect(provenance.dropped_items.length).toBeGreaterThan(0);

    // Dropped WHOLE, never sliced: no fragment of the plan reached the model.
    const sent = JSON.stringify(llm.calls);
    expect(sent).not.toContain(SENTINEL);
    expect(sent).not.toContain('requirement line that is quite long indeed');
    // Recorded by SOURCE, never by content.
    expect(JSON.stringify(provenance.dropped_items)).not.toContain(SENTINEL);
    await a.close();
  });

  // ──────────────────────────────────────── freshness and the cache ──

  /** AC-18 — every input unchanged ⇒ the stored brief and no second call. */
  it('returns the stored brief with zero further model calls when nothing changed', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    const first = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    const callsAfterFirst = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsAfterFirst).toBe(1);

    const second = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    expect(second.generated_at).toBe(first.generated_at);
    expect(second.state_fingerprint).toEqual(first.state_fingerprint);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    await a.close();
  });

  /** AC-23 — regenerate spends a call and replaces the brief even when fresh. */
  it('regenerate calls the model and replaces the brief on a matching fingerprint', async () => {
    const { app, llm, fixtures } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    const first = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();

    // Same inputs — so without `regenerate` this would be a cache hit.
    fixtures.PrBrief = { ...BRIEF_FIXTURE, what: 'A second opinion about the same change.' };
    const again = await a.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief`,
      payload: { regenerate: true },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<BriefResponse>().what).toBe('A second opinion about the same change.');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);
    // Replaced, not appended: `pr_id` is the primary key, last write wins.
    expect(again.json<BriefResponse>().state_fingerprint.local).toBe(first.state_fingerprint.local);
    const get = (await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    expect(get.what).toBe('A second opinion about the same change.');
    await a.close();
  });

  /** AC-19, AC-31 (server half) — a moved head reads as out of date, by name. */
  it('a moved head reads as out of date and names head_sha', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'moved-head-99' })
      .where(eq(t.pullRequests.id, pr.id));

    const callsBefore = llm.calls.length;
    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    const body = res.json<BriefResponse>();

    expect(body.out_of_date).toBe(true);
    expect(body.moved_inputs).toEqual(['head_sha']);
    // Still readable — an out-of-date brief is marked, never withheld (F-9).
    expect(body.what.length).toBeGreaterThan(0);
    // AC-21: and the read itself cost nothing.
    expect(llm.calls).toHaveLength(callsBefore);
    await a.close();
  });

  /**
   * AC-20, the three locally recomputable cases: a re-derived intent, a moved
   * `indexed_sha`, and a changed `risk_brief` model. Each is detected on the
   * READ path and named, without a model call.
   */
  it('the fingerprint moves for a re-derived intent, a new indexed_sha and a model change', async () => {
    const index = { lastIndexedSha: 'idx-sha-1' };
    const { app, llm } = appWith({ repoIntel: stubRepoIntel({ mutable: index }) });
    const a = await app;
    const { pr } = await setupPr();
    await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const callsAfterAssembly = llm.calls.length;

    const read = async () =>
      (await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    expect((await read()).out_of_date).toBe(false);

    // 1. Intent re-derived — a different derivation is a different input.
    await pg.handle.db
      .update(t.prIntent)
      .set({ derivedAt: new Date('2027-02-02T00:00:00Z'), model: 'another/model' })
      .where(eq(t.prIntent.prId, pr.id));
    let body = await read();
    expect(body.out_of_date).toBe(true);
    expect(body.moved_inputs).toEqual(['intent_derived_at', 'intent_model']);

    // Put it back so the next case is isolated.
    await pg.handle.db
      .update(t.prIntent)
      .set({
        derivedAt: new Date(
          JSON.parse(
            (
              await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id))
            )[0]!.stateFingerprint!,
          ).local_components.intent_derived_at,
        ),
        model: null,
      })
      .where(eq(t.prIntent.prId, pr.id));
    expect((await read()).out_of_date).toBe(false);

    // 2. The repository was re-indexed against a newer tree.
    index.lastIndexedSha = 'idx-sha-2';
    body = await read();
    expect(body.out_of_date).toBe(true);
    expect(body.moved_inputs).toEqual(['indexed_sha']);
    index.lastIndexedSha = 'idx-sha-1';
    expect((await read()).out_of_date).toBe(false);

    // 3. The `risk_brief` model was changed in Settings.
    await pg.handle.db.insert(t.settings).values({
      workspaceId,
      key: 'feature_models',
      value: { risk_brief: { provider: 'openai', model: 'gpt-4.1-mini' } },
    });
    body = await read();
    expect(body.out_of_date).toBe(true);
    expect(body.moved_inputs).toEqual(['model_id']);
    await pg.handle.db.delete(t.settings).where(eq(t.settings.workspaceId, workspaceId));

    // Not one of those reads called a model (AC-21, REQ-9).
    expect(llm.calls).toHaveLength(callsAfterAssembly);
    await a.close();
  });

  /**
   * AC-20, the two REMOTE cases — and the cost D-1a knowingly accepts.
   *
   * An edited linked issue and an edited referenced document both move the
   * fingerprint, but only at the next ASSEMBLY: recomputing the remote half on
   * every PR open means a live GitHub call and a set of clone reads, which is
   * exactly the work D-14 forbids. So the read still says "current" and the
   * next POST is not a cache hit.
   */
  it('an edited issue and an edited document move the remote half at the next assembly', async () => {
    const issues: Record<number, { title: string; body: string; state: string }> = {
      123: { title: 'Public API keeps falling over', body: 'One client sends 900 rps.', state: 'open' },
    };
    const docs = { 'docs/plans/rate-limit.md': '# Plan\n\nAdd a token bucket.' };
    const { app, llm } = appWith({ files: docs, github: stubGithub(issues) });
    const a = await app;
    const { pr } = await setupPr({ body: 'Implements docs/plans/rate-limit.md. Closes #123.' });

    const first = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();

    // The issue is edited upstream.
    issues[123]!.body = 'One client sends 9000 rps, and it is now taking the database with it.';
    // The read cannot see it — that is D-1a's accepted cost, asserted rather
    // than assumed, so a future change that "fixes" it fails here on purpose.
    const readAfterIssueEdit = (
      await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })
    ).json<BriefResponse>();
    expect(readAfterIssueEdit.out_of_date).toBe(false);

    // The next assembly does: the remote half moved, so it is not a cache hit.
    const second = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    expect(second.state_fingerprint.remote).not.toBe(first.state_fingerprint.remote);
    expect(second.state_fingerprint.local).toBe(first.state_fingerprint.local);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);

    // Same again for a referenced document.
    docs['docs/plans/rate-limit.md'] = '# Plan\n\nAdd a leaky bucket instead.';
    const third = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    expect(third.state_fingerprint.remote).not.toBe(second.state_fingerprint.remote);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(3);
    await a.close();
  });

  /**
   * The linked issue is the SAME-REPO `#N`, matched on its whole source.
   *
   * `parseReferences` emits GitHub-URL refs before short `#N` refs, so a body
   * that links our `#123` and cites another repo's issue of the same number
   * puts `other/repo#123` first in `resolved`. Finding the issue content by
   * `source.endsWith('#123')` therefore picked the FOREIGN repo: the
   * `## Linked issue #123` block carried another project's title and body under
   * our number, the real issue was demoted to a plain reference document, and
   * the `linked_issue` fingerprint component digested the wrong text — so
   * editing the actual linked issue stopped moving it.
   */
  it('takes the linked issue from THIS repo when another repo has the same number', async () => {
    // Keyed by `owner/name#n`, unlike `stubGithub`: the whole point here is that
    // the two repos answer differently.
    const issues: Record<string, { title: string; body: string; state: string }> = {};
    const githubByRepo = {
      getIssue: async (repo: { owner: string; name: string }, n: number) => {
        const key = `${repo.owner}/${repo.name}#${n}`;
        return {
          number: n,
          title: issues[key]?.title ?? `Issue ${key}`,
          body: issues[key]?.body ?? '',
          state: issues[key]?.state ?? 'open',
        };
      },
      getPullRequest: async () => {
        throw new Error('not a pull request');
      },
    } as never;

    const { app, llm } = appWith({ github: githubByRepo });
    const a = await app;
    const { repo, pr } = await setupPr({
      body: 'Closes #123. Upstream: https://github.com/other/repo/issues/123',
    });

    issues[`${repo.owner}/${repo.name}#123`] = {
      title: 'Our limiter drops legitimate bursts',
      body: 'Seen on the payments API at 900 rps.',
      state: 'open',
    };
    issues['other/repo#123'] = {
      title: 'Unrelated upstream parser bug',
      body: 'A YAML anchor crashes the loader.',
      state: 'closed',
    };

    const first = (
      await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })
    ).json<BriefResponse>();

    // The `## Linked issue #123` block is OURS. The foreign issue is not gone —
    // it resolved as a reference document — so the assertion that matters is
    // which text sits under the linked-issue heading.
    const input = userInputs(llm);
    const linkedBlock = input.slice(input.indexOf('## Linked issue #123'));
    expect(linkedBlock).toContain('Our limiter drops legitimate bursts');
    expect(linkedBlock).toContain('Seen on the payments API at 900 rps.');
    expect(linkedBlock.slice(0, linkedBlock.indexOf('##', 2))).not.toContain(
      'Unrelated upstream parser bug',
    );

    // The foreign reference is not lost — it is a reference DOCUMENT, which is
    // the other half of the same claim and the one the provenance can state
    // exactly. Pre-fix this was inverted: the foreign issue was the linked
    // issue and OURS was demoted to a document.
    expect(first.references_used).toEqual(['other/repo#123']);
    expect(first.references_used).not.toContain(`${repo.owner}/${repo.name}#123`);

    // Our issue is therefore in the `linked_issue` fingerprint component and in
    // no other — `documents` cannot contain it. So editing it moving the remote
    // half at the next assembly is proof that `linked_issue` digests OUR text.
    issues[`${repo.owner}/${repo.name}#123`]!.body =
      'Seen on the payments API at 9000 rps, and it is now taking the database with it.';
    const second = (
      await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })
    ).json<BriefResponse>();
    expect(second.state_fingerprint.remote).not.toBe(first.state_fingerprint.remote);
    expect(second.state_fingerprint.local).toBe(first.state_fingerprint.local);
    expect(second.references_used).toEqual(['other/repo#123']);
    await a.close();
  });

  // ─────────────────────────────────────────────── refusals and reads ──

  /** AC-22 — no stored brief is an explicit outcome, not a 404 and not a wrapper. */
  it('returns a bare null for a PR with no stored brief, without starting an assembly', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    // A BARE null. `{ brief: null }` would compile on both sides of the HTTP
    // boundary and break only in the card, at runtime.
    expect(res.body).toBe('null');
    expect(res.json()).toBeNull();

    expect(llm.calls).toHaveLength(0);
    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(0);
    await a.close();
  });

  /** AC-25 — both missing inputs are named, and no model call is made. */
  it('422s naming BOTH when there is no intent and the blast map is degraded', async () => {
    const { app, llm } = appWith({
      repoIntel: stubRepoIntel({ state: { status: 'degraded', degradedReason: 'no_data' } }),
    });
    const a = await app;
    const { pr } = await setupPr({ intent: false });

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(422);
    const err = res.json().error;
    expect(err.code).toBe('validation_error');
    expect(err.message).toMatch(/intent/i);
    expect(err.message).toMatch(/blast/i);
    expect(llm.calls).toHaveLength(0);
    await a.close();
  });

  /**
   * AC-26 — one substantive input is enough.
   *
   * This also settles the question the assembler's header raises: it excludes
   * the PR title and body by design, so with no stored intent `why` rests
   * entirely on the linked issue and the referenced documents. The first
   * acceptance criterion still holds — `why` is non-empty — because those two
   * sources carry it.
   */
  it('produces a brief with no intent when the blast map is ok, omitting intent from the sources', async () => {
    const issues: Record<number, { title: string; body: string; state: string }> = {
      123: { title: 'Public API keeps falling over', body: 'One client sends 900 rps.', state: 'open' },
    };
    const { app, llm } = appWith({
      files: { 'docs/plans/rate-limit.md': '# Plan\n\nAdd a token bucket.' },
      github: stubGithub(issues),
    });
    const a = await app;
    const { pr } = await setupPr({
      intent: false,
      body: 'Implements docs/plans/rate-limit.md. Closes #123.',
    });

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json<BriefResponse>();

    expect(body.why.length).toBeGreaterThan(0);
    expect(body.what.length).toBeGreaterThan(0);
    expect(body.inputs_used).not.toContain('intent');
    expect(body.inputs_used).toEqual(['blast', 'diff', 'linked_issue', 'references']);
    // The two sources `why` now rests on really did reach the model.
    const input = userInputs(llm);
    expect(input).toContain('One client sends 900 rps.');
    expect(input).toContain('Add a token bucket.');
    // …and the PR's own prose did not: REQ-2 fixes the input at five sources
    // and the title/body is not one of them (assemble.ts's header).
    expect(input).not.toContain('Implements docs/plans/rate-limit.md. Closes #123.');
    await a.close();
  });

  /** REQ-11, cardinality zero: no stored diff, nothing to be a brief of. */
  it('422s when the PR has no changed files stored', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr({ files: [] });

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/no changed files/i);
    expect(llm.calls).toHaveLength(0);
    await a.close();
  });

  /** A failed model call must leave the stored brief exactly where it was. */
  it('502s on a model failure without replacing the stored brief', async () => {
    const { app } = appWith();
    const a = await app;
    const { pr } = await setupPr();
    const good = (await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();

    const { app: failing } = appWith({ failModel: true });
    const f = await failing;
    const res = await f.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief`,
      payload: { regenerate: true },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('external_service_error');

    const still = (await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json<BriefResponse>();
    expect(still.what).toBe(good.what);
    expect(still.generated_at).toBe(good.generated_at);
    await a.close();
    await f.close();
  });

  // ─────────────────────────────────── how good the inputs were ──

  /**
   * F-6 / spec §6: a `partial` index is the one state where a missing caller
   * means a risk may be UNDERSTATED, and `inputs_used` cannot express it —
   * `blast` is recorded identically for `ok` and `partial`, so the two briefs
   * were byte-identical in everything the card could see.
   */
  it('carries a partial index through to the response, where inputs_used cannot', async () => {
    const partial = appWith({
      repoIntel: stubRepoIntel({ state: { status: 'partial', filesSkipped: 4 } }),
    });
    const pa = await partial.app;
    const { pr: partialPr } = await setupPr();
    const partialBody = (
      await pa.inject({ method: 'POST', url: `/pulls/${partialPr.id}/brief` })
    ).json<BriefResponse>();

    const ok = appWith();
    const oa = await ok.app;
    const { pr: okPr } = await setupPr();
    const okBody = (
      await oa.inject({ method: 'POST', url: `/pulls/${okPr.id}/brief` })
    ).json<BriefResponse>();

    expect(partialBody.blast_state).toBe('partial');
    expect(okBody.blast_state).toBe('ok');
    // The reason the field had to exist: membership is identical either way.
    expect(partialBody.inputs_used).toEqual(okBody.inputs_used);
    expect(partialBody.inputs_used).toContain('blast');

    // …and it survives the round trip through `pr_brief.provenance`, which is
    // where the card actually reads it from.
    const stored = (
      await pa.inject({ method: 'GET', url: `/pulls/${partialPr.id}/brief` })
    ).json<BriefResponse>();
    expect(stored.blast_state).toBe('partial');
    // Coverage travels with it: one changed file, all of it listed.
    expect(stored.changed_files).toEqual({ listed: 1, total: 1 });
    await pa.close();
    await oa.close();
  });

  /** A degraded map is a POSITIVE fact — "no usable index" — and stays one. */
  it('records a degraded map as degraded rather than as an absent one', async () => {
    const { app } = appWith({
      repoIntel: stubRepoIntel({ state: { status: 'degraded', degradedReason: 'no_data' } }),
    });
    const a = await app;
    // Intent is present, so REQ-11 lets the assembly proceed on one input.
    const { pr } = await setupPr();

    const body = (
      await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })
    ).json<BriefResponse>();

    expect(body.blast_state).toBe('degraded');
    expect(body.inputs_used).not.toContain('blast');
    await a.close();
  });

  /**
   * F-7 — the `provenance` column is nullable and a row that predates the
   * feature has one. Serving `inputs_used: []` for it made the card say
   * "Impact is unknown — this repository is not indexed" over a brief that may
   * have been assembled from a perfectly healthy map. Unknown is its own
   * answer and must reach the client as one.
   */
  it('serves an unreadable provenance as unknown, never as a degraded index', async () => {
    const { app } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    // A row exactly as the pre-widening schema allowed: a document, a
    // fingerprint, and no provenance at all.
    await pg.handle.db.insert(t.prBrief).values({
      prId: pr.id,
      json: BRIEF_FIXTURE,
      stateFingerprint: JSON.stringify({ local: 'x', remote: 'y', local_components: {} }),
      provenance: null,
      generatedAt: new Date('2026-08-20T09:00:00.000Z'),
    });

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json<BriefResponse>();

    // The brief itself still reads — an unknown provenance is not a reason to
    // withhold it.
    expect(body.what).toBe(BRIEF_FIXTURE.what);
    // Unknown, and NOT the two things it is not: `[]` ("nothing contributed")
    // and `degraded` ("this repository has no usable index").
    expect(body.inputs_used).toBeNull();
    expect(body.blast_state).toBeNull();
    expect(body.changed_files).toBeNull();
    await a.close();
  });

  it('treats a provenance whose shape has drifted the same as an absent one', async () => {
    const { app } = appWith();
    const a = await app;
    const { pr } = await setupPr();

    await pg.handle.db.insert(t.prBrief).values({
      prId: pr.id,
      json: BRIEF_FIXTURE,
      stateFingerprint: JSON.stringify({ local: 'x', remote: 'y', local_components: {} }),
      // Shape drift: `inputs_used` was never a string.
      provenance: { inputs_used: 'blast', discarded_refs: 4 },
      generatedAt: new Date('2026-08-20T09:00:00.000Z'),
    });

    const body = (
      await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })
    ).json<BriefResponse>();

    expect(body.inputs_used).toBeNull();
    expect(body.blast_state).toBeNull();
    // Nothing is salvaged field-by-field out of a record that did not parse:
    // a `discarded_refs` read out of an otherwise-invalid shape would be a
    // number nobody can vouch for.
    expect(body.discarded_refs).toBe(0);
    await a.close();
  });

  /**
   * Tenancy — the ownership check runs BEFORE any `pr_brief` access.
   *
   * `pr_brief` has no `workspace_id`; it scopes transitively through `pr_id`.
   * A stored row is planted for the other tenant's PR precisely so a read that
   * skipped the check would return it. `server/INSIGHTS.md` records the same
   * bug shape for the intent cache.
   */
  it('404s a PR in another workspace before any pr_brief row is read', async () => {
    const db = pg.handle.db;
    const [other] = await db
      .insert(t.workspaces)
      .values({ name: `other-tenant-${seq++}` })
      .returning();
    const { app } = appWith();
    const a = await app;
    const { pr } = await setupPr({ workspaceId: other!.id });

    // Plant a brief the other tenant would see if the guard were skipped.
    await db.insert(t.prBrief).values({
      prId: pr.id,
      json: BRIEF_FIXTURE,
      stateFingerprint: JSON.stringify({ local: 'x', remote: 'y', local_components: {} }),
      generatedAt: new Date(),
    });

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('Limiter rejects legitimate bursts');

    const post = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(404);
    await a.close();
  });
});
