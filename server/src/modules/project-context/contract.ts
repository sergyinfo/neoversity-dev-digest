/**
 * L05 — the Project Context HTTP envelopes (document list, attachment,
 * projection).
 *
 * This file is the named SOURCE OF TRUTH for these shapes. The client declares
 * its own copies in `client/src/lib/hooks/project-context.ts`; a route test
 * parses live responses against the schemas here, which is what keeps the
 * copies honest.
 *
 * MODULE-LOCAL ON PURPOSE (plan BQ-4/a), for the reason already recorded for
 * blast — see `server/src/modules/blast/contract.ts:1-26` and
 * `server/INSIGHTS.md` (2026-08-23): no route in this server declares a Zod
 * `response:` schema, so responses are typed by TypeScript return annotations
 * and are never validated on the way out. A shared Zod contract for a RESPONSE
 * would therefore buy types only, at the cost of entering a do-not-touch zone
 * and widening the two-vendored-copies byte-identity surface.
 *
 * What IS shared is the substantive part: the per-document shape is the
 * existing `SpecFile` from `@devdigest/shared` (`contracts/platform.ts`),
 * extended in place rather than restated here. Only the thin envelopes are
 * declared per consumer.
 */
import { z } from 'zod';
import { SpecFile } from '@devdigest/shared';
import { MAX_ATTACHMENT_ORDER, MAX_ATTACHMENT_PATH_LEN } from './constants.js';

/**
 * Why a document list came back empty, when it did.
 *
 * THREE DISTINCT OUTCOMES THAT MUST NEVER BE CONFLATED (cross-review F3):
 *  - `null`           — the walk ran. An empty list means the repo genuinely has
 *                       no documents in the allow-listed directories.
 *  - `not_cloned`     — `repos.clone_path` is null: the repo has never been
 *                       cloned, so there is nothing on disk to walk yet.
 *  - `clone_missing`  — `clone_path` IS set but the directory is gone from disk.
 *                       That is a broken local state a resync repairs, not a
 *                       repo that was never set up — and it is the case that
 *                       throws `ENOENT` out of the containment gate's
 *                       `realpath` if it is not classified here.
 *
 * Neither failure is a 500: both return an empty list carrying its own reason.
 */
export const ContextDocListReason = z.enum(['not_cloned', 'clone_missing']);
export type ContextDocListReason = z.infer<typeof ContextDocListReason>;

/** Response of the repo-scoped document listing. Read live from the clone. */
export const ContextDocList = z.object({
  /**
   * Discoverable documents, in a stable order. `content` is never populated in
   * the list — it is returned only when one document is requested.
   */
  files: z.array(SpecFile),
  /**
   * The listing hit the cap (NFR-1) and `files` is a prefix of what is on disk.
   * The UI must say the list is capped rather than implying it is exhaustive.
   */
  capped: z.boolean(),
  /** Why the list is empty; null when the walk actually ran. */
  reason: ContextDocListReason.nullable(),
  /**
   * When the clone was last advanced (`repos.last_polled_at`). The page shows
   * this and points at the existing `POST /repos/:id/resync`; it adds no
   * refresh affordance of its own (§6 Freshness). Null when never synced.
   *
   * Caveat worth keeping in view: that column is bumped when the CLONE
   * finishes, not when PRs sync (`server/INSIGHTS.md` 2026-08-02) — which is
   * exactly the "last synced" meaning wanted here.
   */
  last_synced_at: z.string().nullable(),
});
export type ContextDocList = z.infer<typeof ContextDocList>;

/** What a document can be attached to. */
export const AttachmentTargetKind = z.enum(['agent', 'skill']);
export type AttachmentTargetKind = z.infer<typeof AttachmentTargetKind>;

/**
 * Request body for attaching one document.
 *
 * `repo_id` is REQUIRED and never defaulted to the repo under review: an
 * attachment stores a path, and a path is only meaningful against the
 * repository it was discovered in. Same-name resolution across repos is
 * forbidden (§6 Cross-repo).
 */
export const AttachmentInput = z.object({
  /**
   * Repo-relative POSIX path, as listed.
   *
   * Bounded (fix-brief F10). `path` is the third column of the btree index
   * `ctx_att_agent_repo_path_uq`, so an unbounded one reproduces the
   * `symbols.name` failure documented in the same schema file
   * (`db/schema/context.ts:23-34`) — a 500 carrying a raw Postgres index-row
   * message — and, when `clone_path` is null, `attach` skips the `readDoc`
   * check entirely and inserts it. The bound makes that a 422 here instead.
   *
   * Length only. WHICH paths are legal is `isSafeRelPath` + the allow-list, and
   * both stay in `discovery.ts` as the single source of truth rather than being
   * restated as a regex the two could drift apart on.
   */
  path: z.string().min(1).max(MAX_ATTACHMENT_PATH_LEN),
  /**
   * `.uuid()` per the `IdParams` convention (`_shared/schemas.ts:11`): "an
   * invalid id becomes a clean 422 instead of a downstream DB/500" (F9). These
   * values flow into `eq()` against `uuid` columns, where a malformed one is
   * Postgres error 22P02 — and the global handler echoes `e.message`, so the
   * raw database text would reach the caller.
   */
  repo_id: z.string().uuid(),
  target_kind: AttachmentTargetKind,
  target_id: z.string().uuid(),
  /**
   * Position within the section, ascending. Absent ⇒ the server resolves a
   * stable order by path, so injection order is never arbitrary.
   *
   * Bounded to the `integer` column's range (F10): past `int4` this is a 500
   * carrying `value out of range for type integer`. `.min(0)` matches
   * `ReorderBody`, which has always required a non-negative position.
   */
  order: z.number().int().min(0).max(MAX_ATTACHMENT_ORDER).nullish(),
});
export type AttachmentInput = z.infer<typeof AttachmentInput>;

/**
 * A persisted attachment as returned by the API. `order` is resolved on the way
 * in, so unlike the input shape it is always a concrete number here.
 */
export const AttachmentRow = AttachmentInput.extend({
  id: z.string().uuid(),
  order: z.number().int(),
  created_at: z.string().nullish(),
});
export type AttachmentRow = z.infer<typeof AttachmentRow>;

/**
 * What a run would do with one document, computed for a specific agent.
 *
 *  - `injected`       — it fits the budget and would be sent.
 *  - `dropped_budget` — it would be dropped because the section budget is full.
 *  - `skipped`        — it would not be read at all (missing file, over cap,
 *                       wrong repo). Distinct from `dropped_budget`: raising the
 *                       budget would not change it.
 */
export const ProjectionOutcome = z.enum(['injected', 'dropped_budget', 'skipped']);
export type ProjectionOutcome = z.infer<typeof ProjectionOutcome>;

/** Where a document in a projection came from. */
export const ProjectionOrigin = z.enum(['agent', 'skill']);
export type ProjectionOrigin = z.infer<typeof ProjectionOrigin>;

/** One document the agent would consider, in injection order. */
export const ProjectionEntry = z.object({
  path: z.string().min(1),
  /**
   * The repository the path belongs to — NOT necessarily the repo the
   * projection was computed for (fix-brief F2/F3).
   *
   * An agent can hold documents from several repositories, and the ones
   * belonging to another repository are listed with `outcome: 'skipped'` rather
   * than hidden. Without this field a consumer cannot tell those rows apart
   * from a document that is simply missing, and `path` alone is not a unique
   * key for the list: two repositories can each contain `docs/prd.md`.
   */
  repo_id: z.string().min(1),
  /**
   * Direct attachment, or inherited from an enabled linked skill. Inherited
   * documents must not render as user-selected ones.
   */
  origin: ProjectionOrigin,
  /** The skill it was inherited through; null/absent for a direct attachment. */
  via_skill_id: z.string().nullish(),
  /** Cost including its wrapper. Absent ⇒ show "—" and exclude from the total. */
  tokens_estimate: z.number().int().nullish(),
  outcome: ProjectionOutcome,
});
export type ProjectionEntry = z.infer<typeof ProjectionEntry>;

/**
 * The identity of a resolved document: the repo it belongs to AND its path
 * (fix-brief F3).
 *
 * A path alone is NOT an identity here — an agent can hold `docs/prd.md` from
 * two different repositories, and a projection legitimately lists both (one
 * injected, one skipped as cross-repo). Both server-side users of that identity
 * call this — the dedupe below and the skip-reason map in `assemble.ts` — so
 * they cannot disagree about what "the same document" means. The client mirrors
 * the same tuple as its render key (`ProjectionSummary`), from the `repo_id`
 * now carried on every projection entry.
 *
 * A NUL separator, because it is the one byte that cannot appear in either
 * component: `isSafeRelPath` rejects any path containing one. A space would not
 * do — paths with spaces are ordinary.
 */
export function attachmentKey(repoId: string, path: string): string {
  return `${repoId}\u0000${path}`;
}

/**
 * The projection for ONE agent AGAINST ONE REPOSITORY — the basis of REQ-10.
 *
 * It is per agent and never per page: two agents sharing a document can
 * legitimately differ on whether it survives, because survival depends on the
 * agent's own attachments and enabled skills.
 *
 * It is also per REPOSITORY (fix-brief F2), and that half was missing. AC-26
 * requires the projection and the run to agree exactly, and a run always
 * happens against one repository: `readAttachment` skips any document attached
 * to a different repo BEFORE reading it (D-6), because resolving a same-named
 * file from the repo under review would feed one project's spec into another's
 * review. With no repository to compare against, the projection passed each
 * attachment its OWN repo id as the repo under review, so that guard evaluated
 * `x !== x` — permanently false, the branch dead — and a multi-repo agent's
 * page showed documents the run would never send.
 *
 * The repo is supplied by the caller as a required `repo_id` query parameter
 * and echoed here. Required rather than optional, and echoed rather than
 * implied, for the same reason `agent_id` is: an unattributed projection is not
 * interpretable, and a silent default would be a third set of semantics that
 * no acceptance criterion covers.
 */
export const Projection = z.object({
  /** A projection is meaningless unattributed, so this is required. */
  agent_id: z.string().min(1),
  /** The repository the projection was computed against. */
  repo_id: z.string().min(1),
  /** The section budget in force. Rendered rather than assumed. */
  budget_tokens: z.number().int().nonnegative(),
  /**
   * What a run would send in total: surviving documents, their wrappers, and
   * the section heading. It is NOT the sum of the entry estimates, and a
   * consumer must never fall back to summing rows.
   */
  projected_tokens: z.number().int().nonnegative(),
  entries: z.array(ProjectionEntry),
});
export type Projection = z.infer<typeof Projection>;
