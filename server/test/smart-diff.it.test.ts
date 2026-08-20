import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Review, SmartDiff } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/middleware/ratelimit.ts b/src/middleware/ratelimit.ts
--- a/src/middleware/ratelimit.ts
+++ b/src/middleware/ratelimit.ts
@@ -24,3 +24,5 @@
   port: 3000,
+  const key = bucketKey(req);
   redisUrl: x,`;

/** One finding on the core file, so a badge has somewhere to land. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Rate limiter needs work.',
  score: 60,
  findings: [
    {
      id: 'f-1',
      severity: 'WARNING',
      category: 'bug',
      title: 'Expiry is set on every request',
      file: 'src/middleware/ratelimit.ts',
      start_line: 25,
      end_line: 25,
      explanation: 'The key TTL is reset each call.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** A PR shaped like the feature's motivating example: logic + wiring + a lock file. */
const FILES = [
  { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
  { path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
  { path: 'src/api/public/index.ts', additions: 12, deletions: 2 },
  { path: 'src/config.ts', additions: 4, deletions: 0 },
  { path: 'package.json', additions: 3, deletions: 1 },
  { path: 'package-lock.json', additions: 920, deletions: 240 },
];

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-sd-${seq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      filesCount: FILES.length,
      status: 'needs_review',
      body: null,
    })
    .returning();
  await db.insert(t.prFiles).values(
    FILES.map((f) => ({
      prId: pr!.id,
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: '@@ -24,3 +24,5 @@\n   port: 3000,\n+  const key = bucketKey(req);\n   redisUrl: x,',
    })),
  );
  return { repo: repo!, pr: pr! };
}

d('L03 Smart Diff (Testcontainers pg)', () => {
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

  function appWith() {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW_FIXTURE } });
    return {
      llm,
      app: buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: DIFF }),
          llm: { openai: llm },
        },
      }),
    };
  }

  const group = (sd: SmartDiff, role: string) => sd.groups.find((g) => g.role === role)!;

  it('groups and orders files with no review yet, and makes NO model call', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr(pg.handle.db, workspaceId);

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const sd = res.json<SmartDiff>();

    // Core first — the whole point of the feature.
    expect(sd.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    expect(group(sd, 'core').files.map((f) => f.path)).toEqual([
      'src/middleware/ratelimit.ts', // 84 changed lines
      'src/api/public/webhooks.ts', // 37
    ]);
    expect(group(sd, 'wiring').files.map((f) => f.path)).toEqual([
      'src/api/public/index.ts',
      'src/config.ts',
    ]);
    // The acceptance criterion: a lock file is ALWAYS boilerplate.
    expect(group(sd, 'boilerplate').files.map((f) => f.path)).toContain('package-lock.json');

    // Sorting works before any review exists; there is simply nothing to badge.
    expect(sd.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);

    // THE acceptance criterion: viewing Smart Diff must not create an LLM request.
    expect(llm.calls).toHaveLength(0);

    await a.close();
  });

  it('leaves pseudocode_summary null, because filling it would need a model', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr(pg.handle.db, workspaceId);

    const sd = (await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })).json<SmartDiff>();
    expect(sd.groups.flatMap((g) => g.files).every((f) => f.pseudocode_summary == null)).toBe(true);
    expect(llm.calls).toHaveLength(0);
    await a.close();
  });

  it('surfaces the latest review findings as finding_lines — and still no model call', async () => {
    const { app, llm } = appWith();
    const a = await app;
    const { pr } = await setupPr(pg.handle.db, workspaceId);

    const agent = (
      await a.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SD', provider: 'openai', model: 'gpt-4.1', system_prompt: 'base' },
      })
    ).json();

    await a.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const callsAfterReview = llm.calls.length;
    expect(callsAfterReview).toBeGreaterThan(0); // the review itself did call the model

    const sd = (await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })).json<SmartDiff>();
    const ratelimit = group(sd, 'core').files.find(
      (f) => f.path === 'src/middleware/ratelimit.ts',
    )!;
    expect(ratelimit.finding_lines).toEqual([25]);

    // Reading Smart Diff added nothing on top of the review's own calls.
    expect(llm.calls).toHaveLength(callsAfterReview);

    await a.close();
  });

  it('404s for a PR in another workspace', async () => {
    const { app } = appWith();
    const a = await app;
    const { pr } = await setupPr(pg.handle.db, workspaceId);

    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${seq++}` })
      .returning();
    // Route the request through a PR id that exists, but under a workspace that
    // does not own it — the guard must live in the service, not in the caller.
    const { SmartDiffService } = await import('../src/modules/smart-diff/service.js');
    await expect(
      new SmartDiffService(a.container).forPull(other!.id, pr.id),
    ).rejects.toThrow(/not found/i);

    await a.close();
  });
});
