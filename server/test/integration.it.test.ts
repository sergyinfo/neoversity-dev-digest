import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('Testcontainers: pg + pgvector', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('migrations applied: every table exists', async () => {
    const rows = await pg.handle.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public'`;
    // 35 domain tables + drizzle migration bookkeeping
    expect(rows[0]!.count).toBeGreaterThanOrEqual(35);
  });

  it('pgvector extension is enabled', async () => {
    const rows = await pg.handle.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('vector insert + similarity query round-trips', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'v', name: 'vec', fullName: 'v/vec' })
      .returning();
    const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(t.codeChunks).values({
      workspaceId,
      repoId: repo!.id,
      path: 'a.ts',
      content: 'hello',
      embedding: vec,
      source: 'code',
    });
    // cosine distance query against the same vector → distance ~0
    const literal = `[${vec.join(',')}]`;
    const rows = await pg.handle.sql<{ dist: number }[]>`
      SELECT embedding <=> ${literal}::vector AS dist
      FROM code_chunks WHERE repo_id = ${repo!.id}`;
    expect(rows[0]!.dist).toBeLessThan(0.0001);
  });

  it('seed is idempotent (re-run does not duplicate workspace)', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const ws = await pg.handle.db.select().from(t.workspaces);
    expect(ws.filter((w) => w.name === 'default')).toHaveLength(1);
  });
});

d('Testcontainers: DB-backed routes via app.inject', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos persists + enqueues a clone (mock git) and GET /repos lists it', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const git = new MockGitClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/widgets' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().full_name).toBe('acme/widgets');

    await app.container.jobs.onIdle();
    expect(git.cloned.some((c) => c.repo.name === 'widgets')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.json().some((r: { full_name: string }) => r.full_name === 'acme/widgets')).toBe(
      true,
    );
    await app.close();
  });

  it('GET /repos/:id/pulls imports PRs (mock GitHub) idempotently', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    const repoId = repos.json()[0]!.id;

    const first = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(first.statusCode).toBe(200);
    expect(first.json().length).toBeGreaterThan(0);
    // import again → still idempotent (unique repo_id+number)
    const second = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(second.json().length).toBe(first.json().length);
    await app.close();
  });

  it('GET /repos/:id/pulls carries per-severity findings for the LATEST review only', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const imported = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    const target = imported.json()[0]!;

    const db = pg.handle.db;
    const [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, target.id))
      .limit(1);
    const workspaceId = pr!.workspaceId;

    const mkReview = async (createdAt: Date) => {
      const [row] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: target.id,
          kind: 'review',
          verdict: 'request_changes',
          summary: 's',
          score: 40,
          createdAt,
        })
        .returning();
      return row!.id;
    };
    const mkFinding = (reviewId: string, severity: string) => ({
      reviewId,
      file: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      severity,
      category: 'bug',
      title: 'T',
      // Drizzle column key — the DB column is still `rationale` (the contract
      // field is `explanation`; they are mapped at the repository boundary).
      rationale: 'R',
      confidence: 0.9,
    });

    // Dates are relative to now, not fixed: the seeded PR already carries a
    // review stamped at seed time, and a hardcoded 2026 date silently lost the
    // "latest" race against it.
    const now = Date.now();

    // An older review with a very different mix — if the aggregate leaked across
    // reviews, these three SUGGESTIONs would surface in the counts below.
    const older = await mkReview(new Date(now - 86_400_000));
    await db
      .insert(t.findings)
      .values([
        mkFinding(older, 'SUGGESTION'),
        mkFinding(older, 'SUGGESTION'),
        mkFinding(older, 'SUGGESTION'),
      ]);

    const latest = await mkReview(new Date(now + 3_600_000));
    await db
      .insert(t.findings)
      .values([
        mkFinding(latest, 'CRITICAL'),
        mkFinding(latest, 'CRITICAL'),
        mkFinding(latest, 'WARNING'),
      ]);

    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    const row = list.json().find((p: { id: string }) => p.id === target.id);
    // SUGGESTION is 0, not absent: the UI needs "none of these" to be sayable.
    expect(row.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });

    // A PR nobody has reviewed reports null — a different state from a clean 0/0/0.
    const untouched = list
      .json()
      .find((p: { id: string; score: number | null }) => p.id !== target.id && p.score === null);
    if (untouched) expect(untouched.findings_by_severity).toBeNull();

    await app.close();
  });

  it('POST /repos/:id/poll syncs PR list and does NOT trigger a review', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const poll = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(poll.json().reviewTriggered).toBe(false);
    expect(poll.json().synced).toBeGreaterThan(0);
    await app.close();
  });
});
