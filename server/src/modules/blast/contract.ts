/**
 * L04 — the Blast Radius HTTP envelope.
 *
 * MODULE-LOCAL ON PURPOSE (plan R1, decided 2026-08-23). It is deliberately NOT
 * in `@devdigest/shared`, for two reasons:
 *
 *  1. No route in this server declares a Zod `response:` schema — responses are
 *     typed by TypeScript return annotations and are never validated on the way
 *     out. A shared Zod contract for a *response* would therefore buy types
 *     only, at the cost of entering a do-not-touch zone and widening the
 *     two-vendored-copies byte-identity surface (`server/INSIGHTS.md`).
 *  2. `client/src/lib/hooks/repo-intel.ts` already sets the precedent for
 *     exactly this data family: it declares `RepoIntelState` — the response of
 *     `GET /repos/:id/index-state`, with the same `full|partial|degraded|failed`
 *     vocabulary — locally, with the note *"kept local — not in
 *     @devdigest/shared, since repo-intel types live server-side"*.
 *
 * What IS shared is the substantive part: `BlastRadius` and its members already
 * live in `@devdigest/shared` (`contracts/brief.ts`) and are reused here rather
 * than restated. Only the thin envelope is declared per consumer — here, in
 * `client/src/lib/hooks/blast.ts`, and in `mcp/`.
 *
 * This schema is the named SOURCE OF TRUTH for that envelope; the route test
 * parses a live response against it, which is what keeps the three copies
 * honest.
 */
import { z } from 'zod';
import { BlastRadius } from '@devdigest/shared';

/**
 * Whether the map can be trusted.
 *  - `ok`       — the index is complete; the map is the whole story.
 *  - `partial`  — the index skipped files; the map is real but may miss callers.
 *  - `degraded` — no usable index. The map is EMPTY and must never be read as
 *                 "this change impacts nothing".
 */
export const BlastState = z.enum(['ok', 'partial', 'degraded']);
export type BlastState = z.infer<typeof BlastState>;

/**
 * The map itself, reusing the shared shape. `summary` is omitted: it is produced
 * by a separate, explicitly-requested LLM call (`POST …/blast/summary`), and the
 * main GET must be provably model-free.
 */
export const BlastMap = BlastRadius.omit({ summary: true });
export type BlastMap = z.infer<typeof BlastMap>;

/** A previously-opened PR that touched at least one of the same files. */
export const PriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  updated_at: z.string(),
  overlapping_files: z.array(z.string()),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastCounts = z.object({
  symbols: z.number().int().nonnegative(),
  callers: z.number().int().nonnegative(),
  endpoints: z.number().int().nonnegative(),
  crons: z.number().int().nonnegative(),
});
export type BlastCounts = z.infer<typeof BlastCounts>;

export const BlastResponse = z.object({
  pr_id: z.string(),
  repo_full_name: z.string(),
  /** The PR head — correct for linking a CHANGED symbol. */
  head_sha: z.string(),
  /**
   * The sha the index was built from — correct for linking a CALLER, whose line
   * number is only valid in that tree. Null when nothing is indexed.
   */
  indexed_sha: z.string().nullable(),
  state: BlastState,
  /** Why the state is not `ok`; null when it is. */
  reason: z.string().nullable(),
  counts: BlastCounts,
  map: BlastMap,
  prior_prs: z.array(PriorPr),
});
export type BlastResponse = z.infer<typeof BlastResponse>;

export const BlastSummaryResponse = z.object({
  summary: z.string(),
  model: z.string(),
  cost_usd: z.number().nullable(),
});
export type BlastSummaryResponse = z.infer<typeof BlastSummaryResponse>;
