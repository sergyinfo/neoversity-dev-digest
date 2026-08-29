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
  /** Repo-relative POSIX path, as listed. */
  path: z.string().min(1),
  repo_id: z.string().min(1),
  target_kind: AttachmentTargetKind,
  target_id: z.string().min(1),
  /**
   * Position within the section, ascending. Absent ⇒ the server resolves a
   * stable order by path, so injection order is never arbitrary.
   */
  order: z.number().int().nullish(),
});
export type AttachmentInput = z.infer<typeof AttachmentInput>;

/**
 * A persisted attachment as returned by the API. `order` is resolved on the way
 * in, so unlike the input shape it is always a concrete number here.
 */
export const AttachmentRow = AttachmentInput.extend({
  id: z.string().min(1),
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
 * The projection for ONE agent — the basis of REQ-10. It is per agent and never
 * per page: two agents sharing a document can legitimately differ on whether it
 * survives, because survival depends on the agent's own attachments and enabled
 * skills.
 */
export const Projection = z.object({
  /** A projection is meaningless unattributed, so this is required. */
  agent_id: z.string().min(1),
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
