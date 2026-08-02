import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext, the limiter fails open when Redis is unreachable, and the webhook route trusts a spoofable client IP. The user-list endpoint also introduces an N+1 query under the new limiter.',
        score: 42,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 61,
        endLine: 68,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Limiter fails open when Redis is unreachable',
        rationale:
          'The catch around the Redis call returns `allowed: true`, so an outage lifts the limit on every public route at once.',
        suggestion: 'Fail closed for unauthenticated callers, or fall back to the local bucket.',
        confidence: 0.93,
      },
      {
        reviewId: review!.id,
        file: 'src/api/public/webhooks.ts',
        startLine: 22,
        endLine: 29,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Webhook signature checked after the body is consumed',
        rationale:
          'The raw body is parsed before `verifySignature`, which then reads a re-serialised object — a forged payload that round-trips to the same JSON passes.',
        suggestion: 'Verify against the raw buffer before parsing.',
        confidence: 0.9,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 34,
        endLine: 38,
        severity: 'WARNING',
        category: 'security',
        title: 'Bucket keyed on X-Forwarded-For without a trusted proxy',
        rationale:
          'The header is attacker-controlled unless the proxy overwrites it, so a caller can rotate the key and bypass the limit.',
        suggestion: 'Use the socket address, or enable Fastify `trustProxy`.',
        confidence: 0.81,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 78,
        endLine: 84,
        severity: 'WARNING',
        category: 'perf',
        title: 'In-memory fallback map is never evicted',
        rationale: 'Keys are added per client but never removed, so the map grows without bound.',
        suggestion: 'Evict on expiry, or use an LRU with a ceiling.',
        confidence: 0.74,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 92,
        endLine: 92,
        severity: 'WARNING',
        category: 'bug',
        title: '429 response omits Retry-After',
        rationale: 'Clients cannot tell how long to wait and typically retry immediately.',
        suggestion: 'Send `Retry-After` with the seconds left in the window.',
        confidence: 0.69,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 55,
        endLine: 59,
        severity: 'WARNING',
        category: 'bug',
        title: 'Read-modify-write on the counter is not atomic',
        rationale:
          'GET then SET can interleave across concurrent requests, letting a burst exceed the limit. Hard to confirm without knowing the deployment topology.',
        suggestion: 'Use INCR with an expiry, or a Lua script.',
        confidence: 0.45,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 12,
        endLine: 14,
        severity: 'SUGGESTION',
        category: 'maintainability',
        title: 'Window and limit are magic numbers',
        rationale: 'The values are inlined, so tuning them means editing the middleware.',
        suggestion: 'Lift them into config alongside the other limits.',
        confidence: 0.72,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 41,
        endLine: 47,
        severity: 'SUGGESTION',
        category: 'maintainability',
        title: 'Key-building logic is duplicated',
        rationale: 'The same key format is assembled in two places and can drift.',
        suggestion: 'Extract a single `bucketKey()` helper.',
        confidence: 0.55,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
