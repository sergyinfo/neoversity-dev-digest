/**
 * hooks/project-context.ts — L05 Project Context: document listing, per-target
 * attachment (agent/skill), and per-agent projection.
 *
 * The HTTP envelopes below are declared LOCALLY, not in `@devdigest/shared`,
 * mirroring `hooks/blast.ts` (plan BQ-4/a): no route in this server declares a
 * Zod `response:` schema, so a shared Zod contract would buy types only, at
 * the cost of entering the do-not-touch zone and widening the two-vendored-
 * copies byte-identity surface. The authoritative shapes live server-side in
 * `server/src/modules/project-context/contract.ts` — this file's field names
 * are kept in sync with it by hand, the same relationship `blast.ts` has with
 * `server/src/modules/blast/contract.ts`.
 *
 * `SpecFile` itself IS shared (`@devdigest/shared`, extended in S1) and is
 * reused, not restated — only the thin envelopes around it are local.
 *
 * DELIBERATE DEVIATION FROM THE PLAN'S S11 TEXT ("`useContextFiles` in
 * `core.ts` is used unchanged"): that hook is typed `api.get<SpecFile[]>` — a
 * bare array — and cannot carry `capped`, `reason` or `last_synced_at`, which
 * cross-review F3's three-value clone state requires reaching the page
 * (`not_cloned` vs `clone_missing` must render as distinct, non-error empty
 * states). `useContextDocs` below is a NEW hook returning the full envelope.
 * `useContextFiles` is left untouched and unused — the same way
 * `useReindexContext` is left unwired per R5 — rather than widening a shared
 * hook from this one feature.
 *
 * Route paths for attach/detach/reorder are an inference, not a value copied
 * from an already-built server route: at the time this file was written,
 * `server/src/modules/project-context/routes.ts` did not exist yet (a
 * concurrent track owns it). The module-local contract (`AttachmentInput`)
 * requires `target_kind` and `target_id` as top-level body fields rather than
 * leaving them implied by the URL, which only makes sense against a single
 * generic collection route rather than one route pair per target kind — that
 * shape is what these hooks call. See the implementer report for this track.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SpecFile } from "@devdigest/shared";

// ---- Document listing ----

/**
 * Why a document list came back empty, when it did — the three-value clone
 * state from cross-review F3. Absent (`null`) means the walk ran and the repo
 * genuinely has no allow-listed documents; the other two must never share
 * copy or be conflated with each other:
 *  - `not_cloned`    — `repos.clone_path` is null; never cloned.
 *  - `clone_missing` — `clone_path` is set but the directory is gone from disk.
 */
export type ContextDocListReason = "not_cloned" | "clone_missing";

/** Response of the repo-scoped document listing (`GET /repos/:id/context`). */
export interface ContextDocList {
  /** Discoverable documents, in a stable order. `content` is never populated here. */
  files: SpecFile[];
  /** The listing hit the cap (NFR-1); `files` is a prefix of what is on disk. */
  capped: boolean;
  /** Why the list is empty; null when the walk actually ran. */
  reason: ContextDocListReason | null;
  /** When the clone was last advanced (`repos.last_polled_at`). Null when never synced. */
  last_synced_at: string | null;
}

/**
 * GET /repos/:id/context — the full envelope, including the three-value
 * clone-state `reason` (F3). Declared here rather than reusing
 * `useContextFiles` (`hooks/core.ts`) — see the file header.
 */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-docs", repoId],
    queryFn: () => api.get<ContextDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

// ---- Attachments ----

/** What a document can be attached to. */
export type AttachmentTargetKind = "agent" | "skill";

/** Request body for attaching one document. */
export interface AttachmentInput {
  /** Repo-relative POSIX path, as listed. */
  path: string;
  /**
   * Required and never defaulted to the repo under review — an attachment
   * stores a path, and a path is only meaningful against the repository it
   * was discovered in (§6 Cross-repo).
   */
  repo_id: string;
  target_kind: AttachmentTargetKind;
  target_id: string;
  /** Position within the section, ascending. Omitted ⇒ server resolves a stable order. */
  order?: number | null;
}

/** A persisted attachment, as returned by the API. */
export interface AttachmentRow extends AttachmentInput {
  id: string;
  order: number;
  created_at?: string | null;
}

/**
 * Attach one document to an agent or a skill.
 *
 * §9: on failure the caller must surface it and revert the toggle rather than
 * optimistically succeeding. This hook does no optimistic cache update on
 * `onMutate` — the local toggle state a caller renders is theirs to own and
 * revert in `onError`; this hook only ever reflects the server's real outcome.
 */
export function useAttachContextDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AttachmentInput) =>
      api.post<AttachmentRow>("/context/attachments", input),
    onSuccess: (_row, input) => {
      qc.invalidateQueries({ queryKey: ["context-docs", input.repo_id] });
      if (input.target_kind === "agent") {
        qc.invalidateQueries({ queryKey: ["context-projection", input.target_id] });
      }
    },
  });
}

export interface DetachContextDocInput {
  id: string;
  repo_id: string;
  target_kind: AttachmentTargetKind;
  target_id: string;
}

/** Detach a document. Same no-optimism rule as attach (§9). */
export function useDetachContextDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DetachContextDocInput) =>
      api.del<{ deleted: string }>(`/context/attachments/${input.id}`),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["context-docs", input.repo_id] });
      if (input.target_kind === "agent") {
        qc.invalidateQueries({ queryKey: ["context-projection", input.target_id] });
      }
    },
  });
}

export interface ReorderContextDocInput {
  id: string;
  order: number;
  target_kind: AttachmentTargetKind;
  target_id: string;
}

/** Change one attachment's position within its target's section (REQ-4/5). */
export function useReorderContextDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReorderContextDocInput) =>
      api.patch<AttachmentRow>(`/context/attachments/${input.id}`, { order: input.order }),
    onSuccess: (_row, input) => {
      if (input.target_kind === "agent") {
        qc.invalidateQueries({ queryKey: ["context-projection", input.target_id] });
      }
    },
  });
}

// ---- Projection ----

/**
 * What a run would do with one document, computed for a specific agent.
 *  - `injected`       — fits the budget and would be sent.
 *  - `dropped_budget` — would be dropped because the section budget is full.
 *  - `skipped`        — would not be read at all (missing file, over cap,
 *                       wrong repo). Distinct from `dropped_budget`: raising
 *                       the budget would not change it.
 */
export type ProjectionOutcome = "injected" | "dropped_budget" | "skipped";

/** Where a document in a projection came from. */
export type ProjectionOrigin = "agent" | "skill";

/** One document the agent would consider, in injection order. */
export interface ProjectionEntry {
  path: string;
  /** Direct attachment, or inherited from an enabled linked skill. */
  origin: ProjectionOrigin;
  /** The skill it was inherited through; absent for a direct attachment. */
  via_skill_id?: string | null;
  /** Cost including its wrapper. Absent ⇒ show "—" and exclude from the total. */
  tokens_estimate?: number | null;
  outcome: ProjectionOutcome;
}

/**
 * The projection for ONE agent (REQ-10) — never a page-wide figure (D-9): the
 * inherited set and order differ per agent, so the projection and its drop
 * marking are computed per agent.
 */
export interface Projection {
  agent_id: string;
  /** The section budget in force, currently 8 000. */
  budget_tokens: number;
  /**
   * What a run would send in total: surviving documents, their wrappers, and
   * the section heading. NOT the sum of `entries[].tokens_estimate` — a
   * consumer must never fall back to summing rows (§9).
   */
  projected_tokens: number;
  entries: ProjectionEntry[];
}

/**
 * GET /agents/:id/context/projection — the projected token cost a run would
 * send for this agent right now, including inherited enabled-skill documents.
 * Disabled when no agent is selected (D-11) — the caller decides whether "no
 * agent in view" or "loading" or "unavailable" is shown.
 */
export function useAgentContextProjection(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-projection", agentId],
    queryFn: () => api.get<Projection>(`/agents/${agentId}/context/projection`),
    enabled: !!agentId,
  });
}
