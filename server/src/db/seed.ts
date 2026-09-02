import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { defaultFeatureModel } from '../platform/feature-models.js';
import { BriefRepository } from '../modules/brief/repository.js';
import {
  computeFingerprint,
  localComponents,
  serializeFingerprint,
} from '../modules/brief/fingerprint.js';
import { ASSEMBLER_VERSION } from '../modules/brief/constants.js';
import type { BriefDocument, BriefProvenance } from '../modules/brief/contract.js';
import { resolveCloneRoot, readDoc } from '../modules/project-context/discovery.js';
import { assembleProjectContext, specsReadFor, type ResolvedDoc } from '../modules/project-context/assemble.js';
import { PROJECT_CONTEXT_TOKEN_BUDGET } from '../modules/project-context/constants.js';
import { saveRunTrace } from '../modules/reviews/repository/run.repo.js';
import { TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { FindingCategory, Severity } from '@devdigest/shared';
import type { Finding, RunTrace } from '@devdigest/shared';
import { sliceDiff } from '@devdigest/reviewer-core';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { diffFromPrFiles } from '../modules/reviews/diff-loader.js';
import { EvalsRepository, type EvalCaseRow } from '../modules/evals/repository.js';
import { score } from '../modules/evals/scoring.js';
import type {
  ActualOutput,
  EvalAgentSnapshot,
  EvalExpectation,
  ExpectedOutput,
} from '../modules/evals/contract.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * L05 (S18) — the fixture `project-context`'s e2e flow `08` (and any test
 * pointed at the seeded demo repo) reads. Its contents are not arbitrary —
 * see `server/test/fixtures/context-clone/` for what each file proves:
 * a leading-segment match (`docs/a.md`), a NON-leading-segment match
 * (`server/docs/intent-layer.md`, the D-2a case a prefix rule would miss),
 * the `.devdigest/specs/` prefix predicate, two committable negatives
 * (`README.md`, `src/notes.md`), and one deliberately oversized document
 * (`docs/large-notes.md`) sized to exceed `PROJECT_CONTEXT_TOKEN_BUDGET` on
 * its own so the projection's "Dropped (over budget)" outcome has something
 * real to mark rather than a synthetic one.
 */
const CONTEXT_CLONE_PATH = join(__dirname, '..', '..', 'test', 'fixtures', 'context-clone');

/**
 * L06 (S12) — the diff hunks the labelled dataset rests on.
 *
 * Every `patch` here carries HUNKS ONLY — no `diff --git`/`---`/`+++` header
 * lines. `diffFromPrFiles` (reviews/diff-loader.ts) re-adds those itself, and
 * the client's `parsePatch` (diff-viewer/helpers.ts) reads a bare `-`/`+`
 * prefix per line, so a header line would be mis-parsed as a deleted/added line
 * (server/INSIGHTS.md 2026-08-23).
 *
 * THE LINE ARITHMETIC IS THE POINT OF THIS STEP. Before L06 only
 * `src/config.ts` carried a patch, so `diffFromPrFiles` yielded a ONE-FILE diff
 * and every finding on the other three files was unreplayable — and silently
 * so: `sliceDiff` returns the WHOLE diff when the requested path is absent
 * (`reviewer-core/src/review/reduce.ts:70`) rather than an empty string, which
 * would store another file's content as the case input. The eval service now
 * refuses that with a 422, so a finding whose file has no hunk fails case
 * creation loudly instead. Each hunk below is therefore sized so its NEW-SIDE
 * line numbers cover the ranges of the findings seeded against that file:
 *
 *   src/middleware/ratelimit.ts   1–95        findings 3 · 12–14 · 34–38 ·
 *                                             41–47 · 55–59 · 61–68 · 78–84 · 92
 *   src/api/public/webhooks.ts    1–35        findings 1–3 · 22–29
 *   src/api/users.ts              1–6, 40–53  findings 4 · 45–52
 *   src/config.ts                 1–13        findings 9 · 12
 *
 * A CONTEXT line counts as covered exactly like an added one — the parser
 * pushes both onto `newLineNumbers` (`adapters/git/diff-parser.ts`) — so a
 * finding may sit on either.
 */

/** New file: 95 added lines, so `@@ -0,0 +1,95 @@` and every line a `+`. */
const RATELIMIT_PATCH = [
  '@@ -0,0 +1,95 @@',
  "+import type { FastifyReply, FastifyRequest } from 'fastify';",
  "+import { createClient } from 'redis';",
  "+import { promisify } from 'node:util';",
  "+import { config } from '../config.js';",
  '+',
  '+/**',
  '+ * Token-bucket rate limiter for the public API.',
  '+ *',
  '+ * Backed by Redis, with an in-process fallback map so a single node keeps',
  '+ * limiting while Redis is unreachable.',
  '+ */',
  '+const WINDOW_MS = 60_000;',
  '+const LIMIT = 100;',
  '+const BURST = 20;',
  '+',
  '+const redis = createClient({ url: config.redis.url });',
  '+',
  '+type Bucket = { count: number; resetAt: number };',
  '+',
  '+const fallbackBuckets = new Map<string, Bucket>();',
  '+',
  '+export interface LimitDecision {',
  '+  allowed: boolean;',
  '+  remaining: number;',
  '+  resetAt: number;',
  '+}',
  '+',
  '+/**',
  '+ * Resolve the client identity the bucket is keyed on.',
  '+ *',
  '+ * Prefers the forwarded address so callers behind a CDN are limited',
  '+ * individually rather than as one shared edge IP.',
  '+ */',
  '+export function clientKey(req: FastifyRequest): string {',
  "+  const forwarded = req.headers['x-forwarded-for'];",
  "+  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];",
  "+  const ip = first?.trim() || req.socket.remoteAddress || 'unknown';",
  '+  return `${ip}:${req.routeOptions.url ?? req.url}`;',
  '+}',
  '+',
  '+export async function peek(req: FastifyRequest): Promise<number> {',
  "+  const forwarded = req.headers['x-forwarded-for'];",
  "+  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];",
  "+  const ip = first?.trim() || req.socket.remoteAddress || 'unknown';",
  '+  const key = `rl:${ip}:${req.routeOptions.url ?? req.url}`;',
  '+  const current = await redis.get(key);',
  '+  return current ? Number(current) : 0;',
  '+}',
  '+',
  '+export async function consume(req: FastifyRequest): Promise<LimitDecision> {',
  '+  const key = `rl:${clientKey(req)}`;',
  '+  const now = Date.now();',
  '+  const resetAt = now + WINDOW_MS;',
  '+',
  '+  try {',
  '+    const raw = await redis.get(key);',
  '+    const count = raw ? Number(raw) : 0;',
  '+    const next = count + 1;',
  '+    await redis.set(key, String(next), { PX: WINDOW_MS });',
  '+    return { allowed: next <= LIMIT + BURST, remaining: Math.max(0, LIMIT - next), resetAt };',
  '+  } catch (err) {',
  "+    req.log.warn({ err }, 'rate limiter: redis unavailable — allowing the request');",
  '+    return {',
  '+      allowed: true,',
  '+      remaining: LIMIT,',
  '+      resetAt,',
  '+    };',
  '+  }',
  '+}',
  '+',
  '+/**',
  '+ * In-process fallback for the single-node dev stack. Keys are added on first',
  '+ * sight and updated in place on every subsequent request.',
  '+ */',
  '+export function consumeLocal(key: string): LimitDecision {',
  '+  const now = Date.now();',
  '+  const existing = fallbackBuckets.get(key);',
  '+  if (!existing || existing.resetAt < now) {',
  '+    const fresh = { count: 1, resetAt: now + WINDOW_MS };',
  '+    fallbackBuckets.set(key, fresh);',
  '+    return { allowed: true, remaining: LIMIT - 1, resetAt: fresh.resetAt };',
  '+  }',
  '+  existing.count += 1;',
  '+  fallbackBuckets.set(key, existing);',
  '+  return { allowed: existing.count <= LIMIT, remaining: LIMIT - existing.count, resetAt: existing.resetAt };',
  '+}',
  '+',
  '+export async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {',
  '+  const decision = await consume(req);',
  '+  if (decision.allowed) return;',
  "+  reply.header('X-RateLimit-Remaining', String(decision.remaining));",
  "+  await reply.code(429).send({ error: 'too_many_requests' });",
  '+}',
  '+',
  '+export const limiterInternals = { fallbackBuckets, clientKey };',
].join('\n');

/** 19 context + 5 removed + 16 added → `@@ -1,24 +1,35 @@`. */
const WEBHOOKS_PATCH = [
  '@@ -1,24 +1,35 @@',
  " import type { FastifyInstance, FastifyRequest } from 'fastify';",
  " import { verifySignature } from '../../lib/signature.js';",
  " import { config } from '../../config.js';",
  "+import { rateLimit } from '../../middleware/ratelimit.js';",
  ' ',
  ' interface WebhookBody {',
  '   id: string;',
  '   type: string;',
  '   data: Record<string, unknown>;',
  ' }',
  ' ',
  ' export async function webhookRoutes(app: FastifyInstance) {',
  '   app.post(',
  "     '/api/public/webhooks/stripe',",
  '+    { preHandler: rateLimit },',
  '     async (req: FastifyRequest, reply) => {',
  '-      const raw = await req.rawBody();',
  "-      if (!verifySignature(raw, req.headers['stripe-signature'], config.webhookSecret)) {",
  "-        return reply.code(400).send({ error: 'invalid_signature' });",
  '-      }',
  '-      const body = JSON.parse(raw) as WebhookBody;',
  '+      const body = req.body as WebhookBody;',
  "+      const signature = req.headers['stripe-signature'];",
  '+',
  '+      // Re-serialise the parsed body so the signature check sees stable JSON.',
  '+      const canonical = JSON.stringify(body);',
  '+      const valid = verifySignature(',
  '+        canonical,',
  "+        String(signature ?? ''),",
  '+        config.webhookSecret,',
  '+      );',
  '+      if (!valid) {',
  "+        return reply.code(400).send({ error: 'invalid_signature' });",
  '+      }',
  '+',
  '       await handleEvent(body);',
  '       return reply.code(202).send({ received: true });',
  '     },',
  '   );',
  ' }',
].join('\n');

/** Two hunks: the import block (1–6) and the list handler (40–53). */
const USERS_PATCH = [
  '@@ -1,5 +1,6 @@',
  " import type { FastifyReply, FastifyRequest } from 'fastify';",
  " import { eq } from 'drizzle-orm';",
  " import { db } from '../db.js';",
  "+import { consume } from '../middleware/ratelimit.js';",
  " import { usersTable, orgMembers } from '../db/schema.js';",
  ' ',
  '@@ -39,4 +40,14 @@',
  ' export async function listUsers(req: FastifyRequest, reply: FastifyReply) {',
  '+  const decision = await consume(req);',
  '+  if (!decision.allowed) {',
  "+    return reply.code(429).send({ error: 'too_many_requests' });",
  '+  }',
  '   const users = await db.select().from(usersTable).limit(100);',
  '-  return reply.send(users);',
  '+  const out = [];',
  '+  for (const u of users) {',
  '+    const orgs = await db.select().from(orgMembers).where(eq(orgMembers.userId, u.id));',
  '+    out.push({ ...u, orgs });',
  '+  }',
  '+',
  '+  return reply.send(out);',
  ' }',
].join('\n');

/**
 * L06 (S12) — the labels. Five findings the reviewer ACCEPTED (each becomes a
 * `must_find` case) and four they DISMISSED (each becomes a `must_not_flag`
 * case), which is what gives the precision half of the score anything to bite
 * on: before this, no seeded finding carried a decision at all, so the demo
 * data could not produce a single eval case.
 *
 * Fixed instants rather than `new Date()` so two seeds of two databases produce
 * byte-identical rows.
 */
const ACCEPTED_AT = new Date('2026-08-26T09:30:00.000Z');
const DISMISSED_AT = new Date('2026-08-26T09:45:00.000Z');

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
        // L05 (S18): points at a real, committed fixture clone rather than
        // `null`, so `project-context` discovery has something to walk
        // without an actual `git clone`. See `CONTEXT_CLONE_PATH` above.
        clonePath: CONTEXT_CLONE_PATH,
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

    // pr_files (subset). Every one carries a `patch` — see the hunk constants
    // at the top of this file for why the line arithmetic matters and how each
    // hunk maps onto the findings inserted below.
    await db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: 'src/middleware/ratelimit.ts',
        additions: 95,
        deletions: 0,
        patch: RATELIMIT_PATCH,
      },
      {
        prId: pr!.id,
        path: 'src/api/public/webhooks.ts',
        additions: 16,
        deletions: 5,
        patch: WEBHOOKS_PATCH,
      },
      // New-side line 12 lands on the Stripe secret key, matching the accepted
      // finding below and the seeded pr_brief's first review-focus entry (S18);
      // line 9 lands on the TODO comment the reviewer DISMISSED as a nit.
      {
        prId: pr!.id,
        path: 'src/config.ts',
        additions: 4,
        deletions: 0,
        patch: [
          '@@ -1,9 +1,13 @@',
          " import { z } from 'zod';",
          ' ',
          ' export const config = {',
          '   port: Number(process.env.PORT ?? 3000),',
          "   env: process.env.NODE_ENV ?? 'development',",
          '   redis: {',
          "     url: process.env.REDIS_URL ?? 'redis://localhost:6379',",
          '   },',
          '+  // Stripe keys — TODO: move to env before merging',
          "+  stripePublishableKey: 'pk_live_EXAMPLE_NOT_A_REAL_KEY_0000',",
          "+  webhookSecret: 'whsec_EXAMPLE_NOT_A_REAL_SECRET_0000',",
          "+  stripeSecretKey: 'sk_live_EXAMPLE_NOT_A_REAL_KEY_0000',",
          ' };',
        ].join('\n'),
      },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 12, deletions: 1, patch: USERS_PATCH },
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
        // L06 (S12): the whole reason the demo exists — line 12 is inside the config.ts hunk.
        acceptedAt: ACCEPTED_AT,
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
        // L06 (S12): lines 61-68 are the `catch` that returns `allowed: true`.
        acceptedAt: ACCEPTED_AT,
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
        // L06 (S12): lines 22-29 are the signature check, after the body was parsed.
        acceptedAt: ACCEPTED_AT,
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
        // L06 (S12): lines 45-52 are the per-user query inside the loop.
        acceptedAt: ACCEPTED_AT,
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
        // L06 (S12): lines 34-38 are `clientKey`, keyed on X-Forwarded-For.
        acceptedAt: ACCEPTED_AT,
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
        // L06 (S12): speculative at 0.45 confidence and unprovable from the diff — the reviewer told the agent to stop reporting it.
        dismissedAt: DISMISSED_AT,
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
      // ---- L06 (S12): three deliberate style nits, all DISMISSED -----------
      //
      // These exist to give `must_not_flag` teeth. Recall alone cannot tell a
      // careful agent from a noisy one — an agent that reports everything scores
      // perfectly on it — so the dataset needs lines a reviewer explicitly said
      // are not worth reporting. They are also what makes the "deliberately
      // degraded prompt" experiment legible: a prompt that invites nitpicking
      // flags exactly these, and precision drops while recall does not move.
      //
      // Each sits OUTSIDE the range of every accepted finding on the same file
      // (ratelimit 3 vs 34-38/61-68, users 4 vs 45-52, config 9 vs 12), so no
      // case ever asks the agent to both find and not find the same lines.
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 3,
        endLine: 3,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Unused import `promisify`',
        rationale: '`promisify` is imported but never referenced in this file.',
        suggestion: 'Drop the import.',
        confidence: 0.62,
        dismissedAt: DISMISSED_AT,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 4,
        endLine: 4,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Import alias `consume` is too generic',
        rationale:
          'At the call site `consume(req)` reads as consuming the request, not a rate-limit token.',
        suggestion: 'Import it as `consumeRateLimit`.',
        confidence: 0.48,
        dismissedAt: DISMISSED_AT,
      },
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 9,
        endLine: 9,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'TODO comment carries no owner or ticket',
        rationale: 'A bare `TODO:` has nobody attached to it and no date it expires.',
        suggestion: 'Reference the ticket, or delete the comment.',
        confidence: 0.4,
        dismissedAt: DISMISSED_AT,
      },
    ]);

    // ---- L05 pr_brief: a stored brief that reads as a clean cache hit -------
    //
    // The read path (`brief/service.ts#get`) recomputes only the LOCAL half of
    // the fingerprint (`brief/fingerprint.ts`) from the PR's current state and
    // compares it component-by-component against what is stored — so the
    // stored value must be produced by the SAME functions the service calls,
    // not a hand-written digest, or a byte anywhere in the eight components
    // disagrees and the card renders the out-of-date marker instead of a clean
    // hit. The eight local components on a FRESH seed, and why each is what it
    // is:
    //   - head_sha: the PR's own seeded `headSha`.
    //   - intent_derived_at / intent_model: no `pr_intent` row is seeded for
    //     this PR (it is a zero-writer table until the intent lesson runs one),
    //     so `container.intent(log).get()` returns null and both read 'none'.
    //   - indexed_sha / blast_state: no repo-intel index exists on a fresh DB,
    //     so `getIndexState` synthesises `{status: 'degraded', lastIndexedSha:
    //     ''}` (`repo-intel/service.ts:191-206`) — indexed_sha is 'none',
    //     blast_state is 'degraded'.
    //   - model_provider / model_id: no `feature_models` override is seeded in
    //     Settings, so `resolveFeatureModel` falls back to the registry default
    //     for `risk_brief` — reused here via `defaultFeatureModel` rather than
    //     hardcoding 'openai'/'gpt-4.1', so a registry change cannot silently
    //     desync this fixture from what the service will compute.
    //   - assembler_version: the module's own constant.
    // The remote half (linked issue + reference documents) is 'none'/'none':
    // the seeded PR body links no issue and no document.
    const riskBriefModel = defaultFeatureModel('risk_brief');
    const localState = localComponents({
      headSha: pr!.headSha,
      intent: null,
      blast: { indexed_sha: null, state: 'degraded' },
      model: riskBriefModel,
      assemblerVersion: ASSEMBLER_VERSION,
      issue: null,
      documents: [],
    });
    const fingerprint = computeFingerprint({
      headSha: pr!.headSha,
      intent: null,
      blast: { indexed_sha: null, state: 'degraded' },
      model: riskBriefModel,
      assemblerVersion: ASSEMBLER_VERSION,
      issue: null,
      documents: [],
    });

    const briefDocument: BriefDocument = {
      what: 'Adds a token-bucket rate limiter in front of the public API endpoints, including a new config block that wires in Redis and Stripe credentials, and updates the webhook and user-list routes to use it.',
      why: 'Unauthenticated clients could call the public endpoints without limit, so this change throttles them per client before the endpoints ship more broadly.',
      risk_level: 'high',
      risks: [
        {
          kind: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          explanation:
            'A literal `sk_live_` Stripe secret key is committed in plaintext, readable by anyone with repo access and preserved in history even after rotation.',
          severity: 'high',
          file_refs: ['src/config.ts:12'],
        },
        {
          kind: 'security',
          title: 'Limiter fails open when Redis is unreachable',
          explanation:
            'The catch around the Redis call returns `allowed: true`, so a Redis outage lifts the rate limit on every public route at once.',
          severity: 'high',
          file_refs: ['src/middleware/ratelimit.ts:61'],
        },
        {
          kind: 'security',
          title: 'Webhook signature checked after the body is consumed',
          explanation:
            'The raw body is parsed before `verifySignature`, which then reads a re-serialised object — a forged payload that round-trips to the same JSON passes.',
          severity: 'medium',
          file_refs: ['src/api/public/webhooks.ts:22'],
        },
      ],
      // First entry MUST stay src/config.ts:12 — S19's flow clicks it by its
      // accessible name to exercise the Files-tab jump (BQ-5/A). Its line is
      // grounded: the seeded `src/config.ts` patch above is `@@ -1,9 +1,13 @@`,
      // so head line 12 falls inside a hunk.
      //
      // The other two entries carry NO line. That was FORCED until L06 (S12) —
      // the two files they name were seeded without a `patch`, so there were no
      // hunk ranges for a line to be grounded against and `filterReferences`
      // would have cleared one on a real assembly. Both files now carry hunks
      // (`RATELIMIT_PATCH` covers 61-68, `WEBHOOKS_PATCH` covers 22-29), so a
      // line here would ground; it is left null because this is a STORED brief
      // and rewriting the fixture is not S12's business. Anyone adding lines
      // here must take them from the hunks above, not from the finding rows.
      review_focus: [
        {
          file: 'src/config.ts',
          line: 12,
          reason: 'Hardcoded Stripe secret key in commit',
        },
        {
          file: 'src/middleware/ratelimit.ts',
          line: null,
          reason: 'Limiter fails open when Redis is unreachable',
        },
        {
          file: 'src/api/public/webhooks.ts',
          line: null,
          reason: 'Webhook signature checked after the body is consumed',
        },
      ],
    };

    // No intent and no blast map contributed (both absent on a fresh seed);
    // 'diff' is the one input this hand-assembled brief actually reflects.
    const briefProvenance: BriefProvenance = {
      inputs_used: ['diff'],
      references_used: [],
      references_skipped: [],
      dropped_items: [],
      estimated_input_tokens: 612,
      tokens_in: 780,
      tokens_out: 214,
      cost_usd: 0.0064,
      discarded_refs: 0,
      model: riskBriefModel.model,
      // The same 'degraded' the local components record above: a fresh DB has
      // no index, so no map contributed and the card must say the impact is
      // unknown rather than imply there is none.
      blast_state: 'degraded',
      // Three `pr_files` rows are seeded for a PR whose `filesCount` is 9, so a
      // real assembly could only ever list three of them — the capped state,
      // stated rather than papered over with `total: 3`.
      changed_files: { listed: 3, total: 9 },
    };

    const briefRepo = new BriefRepository(db);
    await briefRepo.upsertBrief(pr!.id, {
      document: briefDocument,
      fingerprint: serializeFingerprint(fingerprint, localState),
      provenance: briefProvenance,
      model: riskBriefModel.model,
      costUsd: briefProvenance.cost_usd,
      tokensIn: briefProvenance.tokens_in,
      tokensOut: briefProvenance.tokens_out,
      generatedAt: new Date('2026-08-25T09:00:00.000Z'),
    });
  }

  // ---- PR #613 (dependency bump) — the PR with NO brief -------------------
  //
  // WHY A SECOND PR EXISTS AT ALL. AC-28 is "a PR with no stored brief shows
  // the empty state and a generate control", and it cannot be asserted on #482,
  // which is seeded WITH a brief above. One PR could not carry both states, so
  // the flow needed a second row rather than a second fixture.
  //
  // WHAT IT IS DELIBERATELY NOT, because this seed is shared demo data that
  // flows 01, 02, 04, 05 and 09 all read:
  //   - not a second REPO. Flow 01 follows the root redirect to the FIRST repo
  //     and flows 02/04/05/09 assume the demo repo is the only one
  //     (`e2e/README.md` "Precondition: a freshly-seeded DB"). A second repo
  //     would make that redirect ambiguous; a second PR inside this one cannot.
  //   - not a title that can collide. Four flows locate the demo PR with
  //     `find text "Add rate limiting to public API endpoints" click`, and
  //     `find text` matches a SUBSTRING. 'Bump pino to 9.4.0' shares no
  //     substring with that, nor with any other flow's `wait --text` value
  //     ('Pull Requests', 'Security Reviewer', 'request changes', '13 findings',
  //     'Suggestion', 'Hardcoded Stripe secret key in commit', 'src/config.ts',
  //     'WHY & RISK', 'Adds a token-bucket rate limiter', 'RISK LEVEL', 'High',
  //     'stripeSecretKey', 'Add a repository', 'API Keys', 'Feature Models').
  //   - not order-sensitive. `GET /repos/:id/pulls` declares no `orderBy`
  //     (`modules/pulls/routes.ts:87-90`), so no flow may depend on which row
  //     is first — and none does: every one locates its PR by text, never by
  //     position.
  //   - not zero-stat. The list route back-fills diff stats from GitHub for any
  //     PR whose additions, deletions and files_count are all 0
  //     (`pulls/routes.ts:96-118`). On a machine with a real PAT that is a
  //     doomed per-PR round trip on every list load, which is exactly the
  //     latency `e2e/INSIGHTS.md` 2026-08-28 blames for the flaky `find text`
  //     step. Real counts keep this row out of that loop.
  //
  // It gets `pr_files` because a PR with none is refused with 422 on the
  // assembly path — the wrong path for AC-28, which is about the READ path
  // finding no brief. No `pr_brief`, no `pr_intent`, no review and no findings:
  // "no brief" is the whole point of the fixture, and a review here would put a
  // second run on a page flow 04 counts findings on.
  let [bumpPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 613)));
  if (!bumpPr) {
    [bumpPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 613,
        title: 'Bump pino to 9.4.0',
        author: 'dev.okonkwo',
        branch: 'chore/bump-pino',
        base: 'main',
        headSha: 'f7e6d5c4b3a2',
        additions: 3,
        deletions: 3,
        filesCount: 1,
        status: 'needs_review',
        body: 'Routine dependency bump. No behaviour change expected.',
      })
      .returning();

    // Hunks only — no `diff --git`/`---`/`+++` header lines, for the same
    // reason as #482's patch above (server/INSIGHTS.md 2026-08-23).
    await db.insert(t.prFiles).values([
      {
        prId: bumpPr!.id,
        path: 'package.json',
        additions: 3,
        deletions: 3,
        patch: [
          '@@ -18,9 +18,9 @@',
          '   "dependencies": {',
          '     "fastify": "5.2.1",',
          '-    "pino": "9.3.2",',
          '-    "pino-pretty": "11.2.2",',
          '-    "zod": "3.23.8"',
          '+    "pino": "9.4.0",',
          '+    "pino-pretty": "11.3.0",',
          '+    "zod": "3.23.8"',
          '   },',
        ].join('\n'),
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

  // ---- timeline run for the seeded review ----
  // The sample review above had no `agent_runs` row, so PR #482 opened with a
  // timeline containing a commit and nothing else: no run to show a score, a
  // cost, or per-severity badges against. Anything that renders per run was
  // therefore invisible on the only data a fresh install has.
  //
  // Runs after the agents block because the row is linked to Security Reviewer —
  // the seeded findings are secrets/SSRF, which is that agent's brief.
  const [seededReview] = await db
    .select({ id: t.reviews.id, runId: t.reviews.runId, prId: t.reviews.prId })
    .from(t.reviews)
    .where(
      and(
        eq(t.reviews.workspaceId, workspaceId),
        eq(t.reviews.kind, 'review'),
        eq(t.reviews.model, 'seed'),
      ),
    );

  const [securityAgentForContext] = await db
    .select({ id: t.agents.id, provider: t.agents.provider, model: t.agents.model })
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));

  // `seededReview.runId` is read before the run below may set it, so track the
  // id separately rather than re-reading the (stale, in-memory) `seededReview`
  // after the insert — needed further down to attach a run trace on EVERY
  // seed pass, not only the first one that creates the row.
  let timelineRunId: string | null = seededReview?.runId ?? null;

  // ---- L06 (S12): attribute the seeded review to the Security Reviewer ----
  //
  // `POST /findings/:id/eval-case` resolves the owning agent from
  // `reviews.agent_id` FIRST (BQ-2a) and only then from the request body, so a
  // null column sends the one-click affordance down the fallback and — with no
  // body, which is what the button posts — into a 422. The run-attribution
  // update below already writes this column, but only on the pass that CREATES
  // the timeline run; doing it here as well makes the attribution hold on every
  // pass, including a re-seed of a database whose review row predates it.
  //
  // `isNull` in the predicate is what keeps this idempotent AND non-destructive:
  // a review that has since been attributed to some other agent is left alone,
  // and a second seed updates zero rows.
  if (seededReview && securityAgentForContext) {
    await db
      .update(t.reviews)
      .set({ agentId: securityAgentForContext.id })
      .where(and(eq(t.reviews.id, seededReview.id), isNull(t.reviews.agentId)));
  }

  if (seededReview && !seededReview.runId) {
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: securityAgentForContext?.id ?? null,
        prId: seededReview.prId,
        provider: securityAgentForContext?.provider ?? null,
        model: securityAgentForContext?.model ?? null,
        status: 'done',
        durationMs: 8_400,
        tokensIn: 9_119,
        tokensOut: 1_240,
        costUsd: 0.0013,
        // Must match the findings inserted above: 13 total (10 original + L06's
        // three style nits), 3 CRITICAL — the nits are all SUGGESTION, so the
        // blocker count is unchanged. The timeline derives its badges from the
        // findings themselves, but these denormalized counts drive the outcome
        // badge ("rejected" vs "reviewed"), so a mismatch here would colour the
        // row wrongly. NOTE: the accordion header renders `findings.length`,
        // i.e. 13 — `e2e/specs/04-pr-findings.flow.json` asserts on that string.
        findingsCount: 13,
        blockers: 3,
        score: 42,
        grounding: '13/13 passed',
      })
      .returning();

    // Link both ways: the timeline joins run → review through this column.
    await db
      .update(t.reviews)
      .set({ runId: run!.id, agentId: securityAgentForContext?.id ?? null })
      .where(eq(t.reviews.id, seededReview.id));

    timelineRunId = run!.id;
  }

  // ---- L05 (S18): project-context attachments on Security Reviewer --------
  //
  // Two attachments, both against the fixture clone above:
  //   - `server/docs/intent-layer.md` (order 0) — small, injected.
  //   - `docs/large-notes.md` (order 1) — deliberately oversized (see the
  //     fixture comment), dropped for budget. Its presence is what lets the
  //     e2e flow (and the Agent Editor's read-only Context tab, BQ-2/b) show
  //     a REAL "Dropped (over budget)" outcome rather than only ever showing
  //     "Injected".
  //
  // Select-then-insert, matching the guard pattern this file uses everywhere
  // else, since `context_attachments` has no natural "upsert on name" key —
  // the F1 partial unique index would otherwise throw on a second seed pass.
  if (securityAgentForContext) {
    const attachmentSpecs: Array<{ path: string; order: number }> = [
      { path: 'server/docs/intent-layer.md', order: 0 },
      { path: 'docs/large-notes.md', order: 1 },
    ];
    for (const spec of attachmentSpecs) {
      const [existingAttachment] = await db
        .select({ id: t.contextAttachments.id })
        .from(t.contextAttachments)
        .where(
          and(
            eq(t.contextAttachments.workspaceId, workspaceId),
            eq(t.contextAttachments.agentId, securityAgentForContext.id),
            eq(t.contextAttachments.repoId, repoId),
            eq(t.contextAttachments.path, spec.path),
          ),
        );
      if (!existingAttachment) {
        await db.insert(t.contextAttachments).values({
          workspaceId,
          repoId,
          agentId: securityAgentForContext.id,
          path: spec.path,
          order: spec.order,
        });
      }
    }
  }

  // ---- L05 (S18): a run trace demonstrating project context -------------
  //
  // Without this, opening the seeded timeline run's trace drawer shows
  // "no trace" (no `run_traces` row was ever saved for a hand-inserted
  // `agent_runs` row) — nothing to assert AC-24's "Specs read" list or the
  // "Project context (dynamic)" prompt block against. `prompt_assembly.specs`
  // and `specs_read` are computed by calling the SAME `assembleProjectContext`
  // / `specsReadFor` functions the real run path and the projection endpoint
  // call, against the SAME fixture clone the attachments above point at —
  // not hand-written — for the reason already recorded for `pr_brief`
  // (`server/INSIGHTS.md` 2026-08-28): a fixture claiming to reflect real
  // assembly must be produced by the functions that do the assembling, not a
  // parallel hand-authored guess that can silently drift from them.
  if (timelineRunId && securityAgentForContext) {
    const contextRoot = await resolveCloneRoot(CONTEXT_CLONE_PATH);
    if (contextRoot.ok) {
      const tokenizer = new TiktokenTokenizer();
      const docs: ResolvedDoc[] = [];
      for (const rel of ['server/docs/intent-layer.md', 'docs/large-notes.md']) {
        const read = await readDoc(contextRoot.root, rel);
        docs.push({
          path: rel,
          repoId,
          origin: 'agent',
          content: read.ok ? read.content : null,
          skipReason: read.ok ? undefined : read.reason,
        });
      }
      const assembled = assembleProjectContext(docs, tokenizer, {
        budgetTokens: PROJECT_CONTEXT_TOKEN_BUDGET,
      });

      const trace: RunTrace = {
        config: {
          agent: 'Security Reviewer',
          version: '1',
          provider: securityAgentForContext.provider,
          model: securityAgentForContext.model ?? DEFAULT_MODEL,
          pr: 482,
          source: 'local',
        },
        stats: {
          duration_ms: 8_400,
          tokens_in: 9_119,
          tokens_out: 1_240,
          cost_usd: 0.0013,
          findings: 13,
          grounding: '13/13 passed',
        },
        prompt_assembly: {
          system: SECURITY_REVIEWER_PROMPT,
          skills: null,
          memory: null,
          specs: assembled.sectionText || null,
          user: 'Review PR #482 — see the Files changed tab for the diff.',
        },
        tool_calls: [],
        raw_output: JSON.stringify({ verdict: 'request_changes', score: 42 }),
        memory_pulled: [],
        specs_read: specsReadFor(assembled),
        log: [
          { t: '00.10', kind: 'info', msg: 'Starting review with agent Security Reviewer' },
          { t: '00.90', kind: 'result', msg: 'Citation grounding: 13/13 passed' },
        ],
      };
      await saveRunTrace(db, timelineRunId, trace);
    }
  }

  // ---- L06 (S12): eval cases + two synthetic run batches ------------------
  await seedEvalPipeline(db, workspaceId);

  return { workspaceId, userId };
}

/**
 * The degraded system prompt the SECOND synthetic batch was "run" with.
 *
 * Deliberately short and deliberately permissive — "report everything you
 * notice, including style" is precisely the instruction that makes an agent
 * flag the three dismissed nits, which is what drops precision while leaving
 * recall roughly where it was. It is the fixture form of the manual experiment
 * the lesson asks for, so the compare modal has a prompt diff worth reading
 * rather than two identical snapshots.
 */
const DEGRADED_SECURITY_PROMPT = [
  'You are a code reviewer. Read the diff and report anything that looks off.',
  '',
  'Report every issue you notice, including naming, formatting and unused',
  'imports. Be thorough rather than selective.',
].join('\n');

/**
 * Mirrors `caseName()` in `modules/evals/service.ts` — the same format, so a
 * seeded case and a one-click case are indistinguishable in the UI. Duplicated
 * rather than imported because the service's copy is private to the module and
 * this file is data, not a second caller of the service.
 */
function evalCaseName(file: string, start: number, end: number, title: string): string {
  return `${file}:${start}-${end} — ${title}`;
}

/** One synthetic batch: the prompt it ran with, and how it behaved per case. */
interface SyntheticBatch {
  batchId: string;
  ranAt: Date;
  systemPrompt: string;
  durationMs: number;
  costUsd: number;
  /** `file:start_line` of every `must_find` this batch FAILED to produce. */
  misses: Set<string>;
  /** `file:start_line` of every `must_not_flag` this batch wrongly produced. */
  flags: Set<string>;
  /** Cases where one extra finding was produced and the grounding gate dropped it. */
  hallucinates: Set<string>;
}

/**
 * The two batches, fixed so a re-seed writes nothing new.
 *
 * `batch_id` lives inside `actual_output` (the feature adds no column), so it is
 * a plain string — uuid-shaped only to match what the run loop mints with
 * `randomUUID()`, and constant so idempotency has a key to check.
 *
 * Their metrics differ VISIBLY and for a stated reason, because a compare modal
 * with two near-identical batches demonstrates nothing:
 *
 *            recall   precision   citation   passed
 *   baseline  8/9       1.00        1.00       8/9
 *   degraded  6/9       0.67        0.89       3/9
 *
 * Baseline misses exactly one case — the N+1 query, a perf issue outside a
 * SECURITY reviewer's brief, which is the honest thing for it to miss. Degraded
 * keeps the two loudest secrets findings, misses the subtler three, flags all
 * three dismissed nits (precision), and cites two lines outside any hunk that
 * the grounding gate drops (citation accuracy).
 */
const SYNTHETIC_BATCHES: SyntheticBatch[] = [
  {
    batchId: 'b1a7c0de-0000-4000-8000-000000000001',
    ranAt: new Date('2026-08-27T09:15:00.000Z'),
    systemPrompt: SECURITY_REVIEWER_PROMPT,
    durationMs: 4_200,
    costUsd: 0.0021,
    misses: new Set(['src/api/users.ts:45']),
    flags: new Set<string>(),
    hallucinates: new Set<string>(),
  },
  {
    batchId: 'b1a7c0de-0000-4000-8000-000000000002',
    ranAt: new Date('2026-08-28T16:40:00.000Z'),
    systemPrompt: DEGRADED_SECURITY_PROMPT,
    durationMs: 3_800,
    costUsd: 0.0016,
    misses: new Set([
      'src/api/public/webhooks.ts:22',
      'src/api/users.ts:45',
      'src/middleware/ratelimit.ts:34',
    ]),
    flags: new Set(['src/config.ts:9', 'src/api/users.ts:4', 'src/middleware/ratelimit.ts:3']),
    hallucinates: new Set(['src/config.ts:12', 'src/middleware/ratelimit.ts:61']),
  },
];

/**
 * L06 (S12) — the eval dataset: one case per LABELLED finding, plus two
 * synthetic run batches over them.
 *
 * ## Why the rows are seeded at all
 *
 * Every e2e flow in this repo is read-only against a freshly-seeded database
 * (`e2e/README.md`; flow 08's own note "no POST is made anywhere in this
 * flow"), so the Evals flow cannot click "Turn into eval case" to produce its
 * own data — a mutation breaks the freshly-seeded precondition — and it cannot
 * press Run eval, because a run calls a model and flows never do. The rows have
 * to already be there. This is ADDITIVE: the one-click path stays covered by
 * `test/evals.it.test.ts`, and nothing here replaces it.
 *
 * ## No model is called, and no metric is hand-written
 *
 * The batches are plain rows. But their metrics are NOT typed in by hand: each
 * row's synthetic findings are fed through the module's own `score()`, so
 * `recall`, `precision`, `citation_accuracy`, `pass` and `matches[]` are
 * produced by the same function the real run loop uses and cannot drift from
 * the scoring rules. That is the pattern this seed already follows for
 * `pr_brief` and `run_traces` (`server/INSIGHTS.md`, 2026-08-25 / 2026-08-28):
 * a fixture claiming to reflect real computation must be produced by the code
 * that does the computing, not by a parallel hand-written guess.
 *
 * ## Idempotency
 *
 * Cases are keyed on `input_meta->>'finding_id'` — the service's own
 * idempotency key, read through the same repository method — and batches on
 * their fixed `batch_id`. A second `seed()` inserts nothing.
 */
async function seedEvalPipeline(db: Db, workspaceId: string): Promise<void> {
  const [agent] = await db
    .select({
      id: t.agents.id,
      name: t.agents.name,
      systemPrompt: t.agents.systemPrompt,
      model: t.agents.model,
    })
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (!agent) return;

  const [review] = await db
    .select({ id: t.reviews.id, prId: t.reviews.prId })
    .from(t.reviews)
    .where(
      and(
        eq(t.reviews.workspaceId, workspaceId),
        eq(t.reviews.kind, 'review'),
        eq(t.reviews.model, 'seed'),
      ),
    );
  if (!review) return;

  const [pull] = await db
    .select({ id: t.pullRequests.id, number: t.pullRequests.number })
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, review.prId));
  if (!pull) return;

  // Sorted so the case set is identical on every machine — the batch rows below
  // are written in this order and the e2e flow reads the list it produces.
  const labelled = (
    await db.select().from(t.findings).where(eq(t.findings.reviewId, review.id))
  )
    .filter((f) => f.acceptedAt !== null || f.dismissedAt !== null)
    .sort((x, y) => x.file.localeCompare(y.file) || x.startLine - y.startLine);
  // An existing database seeded before L06 has no labels; there is nothing to
  // build a case from and that is not an error.
  if (labelled.length === 0) return;

  const evals = new EvalsRepository(db);
  const diff = await diffFromPrFiles(new ReviewRepository(db), pull.id);

  const cases: { row: EvalCaseRow; expectation: EvalExpectation }[] = [];
  for (const f of labelled) {
    // The same refusal the service makes, for the same reason: `sliceDiff`
    // returns the WHOLE diff for an absent path, so a case built on a file with
    // no hunk would silently store another file's content as its input.
    if (!diff.files.some((x) => x.path === f.file)) continue;

    const severity = Severity.safeParse(f.severity);
    const category = FindingCategory.safeParse(f.category);
    const expectation: EvalExpectation =
      f.acceptedAt !== null
        ? {
            kind: 'must_find',
            file: f.file,
            start_line: f.startLine,
            end_line: f.endLine,
            severity: severity.success ? severity.data : null,
            category: category.success ? category.data : null,
            title: f.title,
          }
        : {
            kind: 'must_not_flag',
            file: f.file,
            start_line: f.startLine,
            end_line: f.endLine,
          };

    const existing = await evals.findCaseByFinding(workspaceId, f.id);
    const row =
      existing ??
      (await evals.insertCase({
        workspaceId,
        ownerId: agent.id,
        name: evalCaseName(f.file, f.startLine, f.endLine, f.title),
        inputDiff: sliceDiff(diff, f.file),
        inputFiles: [f.file],
        inputMeta: {
          finding_id: f.id,
          review_id: f.reviewId,
          pr_id: pull.id,
          pr_number: pull.number,
          decision: f.acceptedAt !== null ? 'accepted' : 'dismissed',
          source: 'finding',
        },
        expectedOutput: { expectations: [expectation] } satisfies ExpectedOutput,
        notes: null,
      }));
    cases.push({ row, expectation });
  }
  if (cases.length === 0) return;

  const skills = await evals.agentSkillsForSnapshot(agent.id);

  for (const batch of SYNTHETIC_BATCHES) {
    // Idempotency: the batch id is fixed, so "already written" is one query.
    const already = await evals.runsForBatch(workspaceId, batch.batchId);
    if (already.length > 0) continue;

    const snapshot: EvalAgentSnapshot = {
      id: agent.id,
      name: agent.name,
      system_prompt: batch.systemPrompt,
      model: agent.model,
      skills: skills.map((sk) => ({
        id: sk.id,
        name: sk.name,
        version: sk.version,
        content_hash: createHash('sha256').update(sk.body, 'utf8').digest('hex'),
      })),
    };

    for (const [i, { row, expectation }] of cases.entries()) {
      const key = `${expectation.file}:${expectation.start_line}`;
      const id = `${batch.batchId.slice(0, 8)}-${i}`;

      // What the agent "produced" and the gate kept.
      const kept: Finding[] = [];
      if (expectation.kind === 'must_find' && !batch.misses.has(key)) {
        kept.push({
          id: `${id}-hit`,
          severity: expectation.severity ?? 'WARNING',
          category: expectation.category ?? 'bug',
          title: expectation.title ?? 'Issue',
          file: expectation.file,
          start_line: expectation.start_line,
          end_line: expectation.end_line,
          explanation: 'Reported on the lines the reviewer accepted.',
          confidence: 0.88,
        });
      }
      if (expectation.kind === 'must_not_flag' && batch.flags.has(key)) {
        kept.push({
          id: `${id}-fp`,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Style nit the reviewer already dismissed',
          file: expectation.file,
          start_line: expectation.start_line,
          end_line: expectation.end_line,
          explanation: 'Reported on lines a reviewer said were not worth reporting.',
          confidence: 0.34,
        });
      }

      // Produced but DROPPED by the grounding gate — line 900 is outside every
      // hunk in this PR, which is exactly what an ungroundable citation is.
      const dropped: Finding[] = batch.hallucinates.has(key)
        ? [
            {
              id: `${id}-ungrounded`,
              severity: 'WARNING',
              category: 'security',
              title: 'Citation outside the diff',
              file: expectation.file,
              start_line: 900,
              end_line: 900,
              explanation: 'Cites a line this PR never touched.',
              confidence: 0.5,
            },
          ]
        : [];

      const scored = score({
        expectations: [expectation],
        findings: kept,
        keptCount: kept.length,
        droppedCount: dropped.length,
      });

      const actualOutput: ActualOutput = {
        batch_id: batch.batchId,
        // Pre-grounding, as produced: survivors first, then the dropped ones —
        // the same order the run loop writes, so `citation_accuracy` stays
        // reconstructable from the row alone.
        findings: [...kept, ...dropped],
        grounded_ids: kept.map((f) => f.id),
        matches: scored.matches,
        agent: snapshot,
      };

      await evals.insertRun({
        caseId: row.id,
        ranAt: batch.ranAt,
        actualOutput,
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citationAccuracy: scored.citation_accuracy,
        durationMs: batch.durationMs,
        costUsd: batch.costUsd,
      });
    }
  }
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
