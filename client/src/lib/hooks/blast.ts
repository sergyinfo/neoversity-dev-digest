"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

/**
 * hooks/blast.ts — the Blast Radius map for a PR.
 *   GET  /pulls/:id/blast          → BlastResponse (index read; no LLM)
 *   POST /pulls/:id/blast/summary  → one-paragraph explanation (one LLM call)
 */

/** Whether the map can be trusted. Mirrors the server's `BlastState`. */
export type BlastState = "ok" | "partial" | "degraded";

export interface PriorPr {
  number: number;
  title: string;
  author: string;
  updated_at: string;
  overlapping_files: string[];
}

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/**
 * The HTTP envelope. Kept local — not in `@devdigest/shared` — following
 * `hooks/repo-intel.ts`, which keeps `RepoIntelState` local for the same reason:
 * repo-intel response shapes live server-side, and no route in this app
 * validates a response at runtime, so a shared Zod contract would buy types
 * only, at the cost of widening the two-vendored-copies invariant.
 *
 * The MAP itself is not restated — `BlastRadius` really is shared, and `summary`
 * is omitted from it here because the summary is a separate, paid call.
 */
export interface BlastResponse {
  pr_id: string;
  repo_full_name: string;
  /** The PR head — correct for linking a CHANGED symbol. */
  head_sha: string;
  /**
   * The sha the index was built from — correct for linking a CALLER, whose line
   * number is only valid in that tree. Null when nothing is indexed.
   */
  indexed_sha: string | null;
  state: BlastState;
  reason: string | null;
  counts: BlastCounts;
  map: Omit<BlastRadius, "summary">;
  prior_prs: PriorPr[];
}

export interface BlastSummary {
  summary: string;
  model: string;
  cost_usd: number | null;
}

/** GET /pulls/:id/blast — the impact map. Cheap: it only reads the index. */
export function useBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/**
 * POST /pulls/:id/blast/summary — the optional paragraph.
 *
 * A mutation rather than a query on purpose: it costs a model call, so it must
 * never fire from a render or a refetch. React Query holds the result; nothing
 * is persisted server-side.
 */
export function useBlastSummary(prId: string | null | undefined) {
  return useMutation({
    mutationFn: () => api.post<BlastSummary>(`/pulls/${prId}/blast/summary`),
  });
}
