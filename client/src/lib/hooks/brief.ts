"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Risk, RiskSeverity } from "@devdigest/shared";

/**
 * hooks/brief.ts — the PR Why & Risk brief.
 *   GET  /pulls/:id/brief  → BriefResponse | null (cache-only read; no LLM)
 *   POST /pulls/:id/brief  → assemble + one model call, then store
 *
 * The HTTP envelope is declared LOCALLY here — not in `@devdigest/shared` —
 * following `hooks/blast.ts:31-56`, which keeps the blast envelope local for
 * the reason its own header sets out: no route in this app validates a
 * response at runtime, so a shared Zod contract would buy types only, at the
 * cost of widening the two-vendored-copies invariant (`diff -rq
 * server/src/vendor/shared client/src/vendor/shared` must print nothing).
 *
 * The SUBSTANTIVE types are not restated: `Risk` and `RiskSeverity` really are
 * shared (`contracts/brief.ts:74-84`) and are imported. The shipped `PrBrief`
 * in that same file is a DIFFERENT, dead shape — do not reach for it here.
 *
 * The named source of truth for every field below is
 * `server/src/modules/brief/contract.ts` (`BriefResponse`). Mirror it; when it
 * changes, this changes with it.
 */

/**
 * The locally recomputable fingerprint components, by name — mirrors the
 * server's `MovedInput` enum. Exhaustive on purpose: the out-of-date marker
 * names one of these and can never name an input the read path cannot see
 * move (an edited linked issue or reference document is caught at the next
 * assembly, never at the next read).
 */
export type MovedInput =
  | "head_sha"
  | "intent_derived_at"
  | "intent_model"
  | "indexed_sha"
  | "blast_state"
  | "model_provider"
  | "model_id"
  | "assembler_version";

/** Which of the five inputs contributed to an assembly. Absence is recorded,
    not inferred — a PR that links nothing is the normal case, not a failure. */
export type BriefInput = "intent" | "blast" | "diff" | "linked_issue" | "references";

/**
 * A source identifier with why it did not make it in.
 *
 * `source` is DISPLAY TEXT, not a stable identifier: for a short GitHub
 * reference it carries the matched keyword, so it reads `"Closes #482"`, not
 * `"#482"`. Render it; never key a list or a lookup on it.
 */
export interface SkippedSource {
  source: string;
  reason: string;
}

/** One thing to read first, most important first. `file` is always a CHANGED
    file and `line` always sits inside a hunk at the PR head — grounding
    guarantees both, so a focus item is always linkable on the Files tab. */
export interface ReviewFocus {
  file: string;
  line?: number | null;
  reason: string;
}

/** Both halves of the state fingerprint. Only `local` is recomputed on the
    read path, which is what `out_of_date` below is derived from. */
export interface BriefFingerprint {
  local: string;
  remote: string;
}

/** The brief as served. Mirrors the server's `BriefResponse`. */
export interface BriefResponse {
  /** What the PR changes, in a reviewer's terms. */
  what: string;
  /** Why the change is being made. */
  why: string;
  /** Overall merge risk. Never defaulted on absence. */
  risk_level: RiskSeverity;
  /** Concrete risks, in the model's order. May be empty. */
  risks: Risk[];
  /** What to read first, most important first. May be empty. */
  review_focus: ReviewFocus[];
  state_fingerprint: BriefFingerprint;
  inputs_used: BriefInput[];
  /** Source identifiers of the reference documents that resolved. */
  references_used: string[];
  references_skipped: SkippedSource[];
  /** References the model produced that grounding discarded. */
  discarded_refs: number;
  /** Null → render "—" via the shipped `formatCost`; never "$0.00". */
  model: string | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  /** When the model was called — the only thing that dates the linked issue
      and the documents this brief read. Render it; never "just now". */
  generated_at: string;
  /** A locally recomputable component differs from the stored one. */
  out_of_date: boolean;
  /** Which ones. Empty whenever `out_of_date` is false. */
  moved_inputs: MovedInput[];
}

/** POST body. `regenerate` forces a fresh assembly over a still-fresh brief. */
export interface GenerateBriefVars {
  regenerate?: boolean;
}

export const briefQueryKey = (prId: string | null | undefined) => ["brief", prId] as const;

/**
 * GET /pulls/:id/brief — the stored brief, or `null` when none is stored.
 *
 * Cache-only and model-free: the route never starts an assembly, so this is
 * safe to hold open on the PR page. A PR with no brief yet is an explicit
 * no-brief outcome, not a 404 — the card shows its empty state and the
 * Generate button, and `isError` stays reserved for a real failure.
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: briefQueryKey(prId),
    queryFn: () => api.get<BriefResponse | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * POST /pulls/:id/brief — assemble and generate.
 *
 * A mutation rather than a query on purpose, exactly as `useBlastSummary`
 * documents at `hooks/blast.ts:73-79`: it costs a model call, so it must
 * never fire from a render or a refetch. Only a user gesture may call
 * `mutate`. The result IS persisted server-side, so the read query is
 * invalidated on success rather than the response being used directly.
 *
 * Call `mutate({})` to generate, `mutate({ regenerate: true })` to replace a
 * brief that is already stored.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: GenerateBriefVars) =>
      api.post<BriefResponse>(`/pulls/${prId}/brief`, {
        regenerate: vars.regenerate ?? false,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: briefQueryKey(prId) });
    },
  });
}
