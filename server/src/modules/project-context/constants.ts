import { REFERENCE_DOC_DIRS } from '../intent/constants.js';

/**
 * L05 — Project Context constants.
 *
 * Every value here carries its §7 rationale, because each one is a product
 * decision rather than an implementation detail: change the number and you
 * change what a run sends to a model.
 */

// ---------------------------------------------------------------------------
// Discovery allow-list — TWO predicates with DIFFERENT matching semantics
// ---------------------------------------------------------------------------
//
// REQ-2 states two, not one: a file qualifies when SOME SEGMENT of its path is
// an allow-listed documentation directory, OR when it sits under
// `.devdigest/specs/`. The two cannot share a list, and the cross-review (F2)
// caught exactly that mistake: `.devdigest/specs` is a TWO-segment string, so
// putting it in a list compared per segment makes the entry silently inert —
// it can never equal any single segment. It would have looked like it worked,
// because `REFERENCE_DOC_DIRS` happens to contain `specs` and
// `.devdigest/specs/prd.md` matches on its own `specs` segment.
//
// So the two predicates are named for their matching semantics and implemented
// separately in `discovery.ts` (`hasAllowedSegment` / `hasAllowedPrefix`).

/**
 * Matched **per path segment** (D-2a), NOT as a leading prefix.
 *
 * Reused from the Intent Layer (`intent/constants.ts:6`) per D-2 rather than
 * copied, so the two features cannot drift on what counts as a doc directory.
 * The MATCHING is deliberately widened relative to `isSafeRepoPath`, which
 * prefix-matches (`intent/references.ts:88`): a leading-prefix rule would miss
 * `server/docs/`, `client/docs/` and `reviewer-core/specs/` — i.e. every
 * documentation directory THIS repository actually has.
 *
 * Residual risk, recorded: this list is owned by `intent`. If `docs` or `plans`
 * were dropped there, discovery here narrows silently. Accepted per D-2;
 * duplicating the list would invite the two copies to diverge instead.
 *
 * `.devdigest/specs` must NOT be added here — see `CONTEXT_DOC_PATH_PREFIXES`.
 */
export const CONTEXT_DOC_DIR_SEGMENTS: readonly string[] = REFERENCE_DOC_DIRS;

/**
 * Matched as a **leading path prefix** — REQ-2's second predicate.
 *
 * Kept as its own predicate rather than dropped as "already covered by the
 * `specs` segment", so that `.devdigest/specs/` discovery survives a change to
 * another module's list. `discovery.ts` has a test that exercises this branch
 * with the segment list stubbed to exclude `specs`, which is what keeps the
 * entry from going quietly inert a second time.
 *
 * Trailing slash is load-bearing: it prevents `.devdigest/specsomething.md`
 * from matching.
 */
export const CONTEXT_DOC_PATH_PREFIXES: readonly string[] = ['.devdigest/specs/'];

// ---------------------------------------------------------------------------
// Limits (§7)
// ---------------------------------------------------------------------------

/** Extensions discovery considers. Lowercased before comparison. */
export const MD_EXTENSIONS: readonly string[] = ['.md', '.mdx'];

/**
 * Per-document byte cap: 64 KB. Larger files are LISTED and marked `over_cap`,
 * but cannot be attached, and an already-attached one is skipped at run time.
 *
 * The number and its reasoning are the existing skill-import cap's
 * (`skills/import.ts:33-34`): "small enough that one import cannot blow a
 * prompt". Two ways to blow a prompt with the same limit is one limit.
 */
export const MAX_DOC_BYTES = 64 * 1024;

/**
 * Listing cap: 500 documents per repo, after which the list says it is capped
 * rather than implying it is exhaustive. Well under repo-intel's 5 000-file
 * index cap (`repo-intel/constants.ts`) — a longer list is unusable by hand,
 * and NFR-1 asks for the listing to stay interactive (under 2 s).
 */
export const MAX_LISTED_DOCS = 500;

/**
 * 20 documents per agent and per skill.
 *
 * CORRECTION (fix-brief F5): this constant used to claim "20 × 64 KB is the
 * ceiling on run-time local reads". IT IS NOT, and never was. `resolveForAgent`
 * returns the agent's own attachments PLUS those of every enabled linked skill,
 * and `linkSkill` (`agents/repository.ts:208-218`) is an unbounded upsert — so
 * this constant bounds one TARGET's attachments at 20 and the per-resolution
 * total at `20 × (1 + N_skills)`, which grows without limit. 100 linked skills
 * meant ~2 020 documents `stat`-ed, read and tokenized on every run AND on
 * every uncached `GET /agents/:id/context/projection`.
 *
 * The real ceiling on run-time local reads is `MAX_DOCS_PER_RESOLUTION` below.
 */
export const MAX_ATTACHMENTS_PER_TARGET = 20;

/**
 * The ceiling on how many documents ONE resolution actually opens — 40.
 *
 * This is a judgement call, not a value read off the spec: §7 fixes the
 * per-target cap and says nothing about the aggregate across linked skills, so
 * some number had to be chosen. `MAX_ATTACHMENTS_PER_TARGET × 2` — the agent's
 * own 20, plus at most 20 more inherited across ALL enabled linked skills
 * combined — because:
 *
 *  - it does not grow with the skill count, which is the property F5 asks for;
 *  - it is far above what can ever be INJECTED anyway. The section budget is
 *    8 000 tokens (~32 KB of prose), so a handful of documents fills it and the
 *    41st was never going to be sent — the cost of reading it was pure waste;
 *  - it leaves every realistic configuration untouched: an agent inheriting 20
 *    or fewer documents in total behaves exactly as before;
 *  - it bounds the worst case at 40 × 64 KB ≈ 2.6 MB and 40 tokenizer passes,
 *    which is what makes §7's "under 500 ms added to run start" and NFR-1's
 *    "under 500 ms" for the projection endpoint attainable again.
 *
 * Documents past the limit are SKIPPED WITH A REASON, not hidden — they appear
 * in the projection and in `RunTrace.specs_read` like any other skip. The cut
 * falls at the tail of injection order, which is the agent's own attachments
 * first and then inherited ones in skill-link order, so the documents dropped
 * are always the ones furthest from the user's explicit per-agent choice.
 */
export const MAX_DOCS_PER_RESOLUTION = MAX_ATTACHMENTS_PER_TARGET * 2;

/**
 * 8 000 estimated tokens for the `## Project context` section, **held
 * separately from the skills budget** (D-4).
 *
 * A shared budget would let attaching a document silently evict a skill —
 * precisely the invisible failure this feature exists to remove. The same
 * number is projected on the page before a run (`GET /agents/:id/context/
 * projection`) and enforced during it, from ONE counter over the same inputs,
 * which is what makes AC-26's equality assertable rather than approximate.
 */
export const PROJECT_CONTEXT_TOKEN_BUDGET = 8_000;

/**
 * The section heading `reviewer-core` renders (`prompt.ts:132`), restated here
 * because that package exports neither the literal nor its `\n\n` join and must
 * not change (plan assumption A1).
 *
 * Duplicated deliberately and with a detector: AC-26 compares the projection
 * against the size recorded by a real run, so a change to the engine's heading
 * fails that test rather than drifting silently.
 */
export const PROJECT_CONTEXT_HEADING = '## Project context';

/** The engine's join between wrapped blocks (`prompt.ts:108`). Same caveat. */
export const PROJECT_CONTEXT_BLOCK_SEPARATOR = '\n\n';

// ---------------------------------------------------------------------------
// Request-shape bounds (fix-brief F10)
// ---------------------------------------------------------------------------

/**
 * Longest repo-relative path that may be ATTACHED — 512 characters.
 *
 * This is the `symbols.name` precedent applied to the other btree-indexed
 * user-supplied string in this file's sibling schema. `MAX_INDEXED_NAME_LEN`
 * (`db/schema/context.ts:23-34`) exists because "Postgres rejects any index row
 * larger than ~2704 bytes", and `path` is the third column of
 * `ctx_att_agent_repo_path_uq` (`db/schema/context.ts:210-215`) — the same
 * failure, one table over. Unbounded, a multi-KB path is a 500 carrying a raw
 * `index row size … exceeds btree version 4 maximum`; bounded, it is a 422 at
 * the edge.
 *
 * 512 chars ≤ ~2 KB even if every character is a 4-byte code point, which
 * leaves room for the two uuids and the row overhead — the same "comfortably
 * safe" margin the 255 was chosen for, scaled to a value that is a path rather
 * than an identifier. Real documentation paths are an order of magnitude
 * shorter; a POSIX filename component maxes out at 255 on its own.
 *
 * Clamping (`clampIndexedName`) is deliberately NOT the model here: a truncated
 * path names a different file, so this refuses rather than trims.
 */
export const MAX_ATTACHMENT_PATH_LEN = 512;

/**
 * Largest accepted `order` — `int4`'s maximum, because the column is
 * `integer` (`db/schema/context.ts:200`).
 *
 * `order` is a position within a section of at most
 * `MAX_ATTACHMENTS_PER_TARGET` documents, so any value near this bound is
 * already meaningless; the point of the bound is only that the column's own
 * limit is enforced where the caller can be told about it, instead of surfacing
 * as a 500 with a raw `value out of range for type integer`.
 */
export const MAX_ATTACHMENT_ORDER = 2_147_483_647;
