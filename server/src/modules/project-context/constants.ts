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
 * 20 documents per agent and per skill. Bounds the worst case BEFORE the token
 * budget applies: 20 × 64 KB is the ceiling on run-time local reads, which is
 * what keeps §7's "under 500 ms added to run start" reachable.
 */
export const MAX_ATTACHMENTS_PER_TARGET = 20;

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
