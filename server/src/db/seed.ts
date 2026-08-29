import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
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
import type { RunTrace } from '@devdigest/shared';

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

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      // `patch` carries HUNKS ONLY — no `diff --git`/`---`/`+++` header lines.
      // `diffFromPrFiles` (reviews/diff-loader.ts) re-adds those itself, and
      // the client's `parsePatch` (diff-viewer/helpers.ts) reads a bare `-`/`+`
      // prefix per line, so a `---`/`+++` header would be mis-parsed as a
      // deleted/added line (server/INSIGHTS.md 2026-08-23). New-side line 12
      // lands on the Stripe secret key, matching the finding at :151-159 below
      // and the seeded pr_brief's first review-focus entry (S18).
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
      // The other two entries carry NO line, because the two files they name are
      // seeded without a `patch` (see the pr_files insert above) — with no hunk
      // ranges there is nothing a line could be grounded against, and
      // `filterReferences` would clear one on a real assembly. A demo that shows
      // a line production would strip is the same three-way disagreement the
      // `path:line` file_refs used to have.
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
  //     ('Pull Requests', 'Security Reviewer', 'request changes', '10 findings',
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
        // Must match the findings inserted above: 10 total, 3 CRITICAL. The
        // timeline derives its badges from the findings themselves, but these
        // denormalized counts drive the outcome badge ("rejected" vs "reviewed"),
        // so a mismatch here would colour the row wrongly.
        findingsCount: 10,
        blockers: 3,
        score: 42,
        grounding: '10/10 passed',
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
          findings: 10,
          grounding: '10/10 passed',
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
          { t: '00.90', kind: 'result', msg: 'Citation grounding: 10/10 passed' },
        ],
      };
      await saveRunTrace(db, timelineRunId, trace);
    }
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
