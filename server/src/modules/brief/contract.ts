/**
 * L05 — the PR Why/Risk Brief: the model's output shape and the HTTP envelope.
 *
 * MODULE-LOCAL ON PURPOSE (spec D-10, decided 2026-08-27). This follows the
 * decision L04 recorded verbatim at `blast/contract.ts:1-26` (and in
 * `server/INSIGHTS.md`, 2026-08-23): no route in this server declares a Zod
 * `response:` schema, so a shared contract for a *response* would buy types
 * only, at the cost of entering `vendor/shared` — a do-not-touch zone carrying
 * a two-copy byte-identity invariant (`diff -rq server/src/vendor/shared
 * client/src/vendor/shared` must print nothing).
 *
 * What IS reused is the substantive part: `Risk` and `RiskSeverity` already
 * live in `@devdigest/shared` (`contracts/brief.ts:74-84`) and are imported
 * here rather than restated. They are the only two symbols this file takes
 * from that package.
 *
 * **Consequence of D-10, stated plainly:** the shipped `PrBrief`
 * (`contracts/brief.ts:143-149`) does NOT gain `what`, `why`, `risk_level` or
 * `review_focus`, and remains dead scaffolding. Do not "finish" it.
 *
 * This file is the named SOURCE OF TRUTH for the envelope; the client declares
 * its own copy in `client/src/lib/hooks/brief.ts`, exactly as `hooks/blast.ts`
 * does for the blast envelope.
 */
import { z } from 'zod';
import { Risk, RiskSeverity } from '@devdigest/shared';

// ============================================================ Model output

/**
 * One thing to read first, most important first.
 *
 * `file` is constrained at grounding time to an allow-listed **changed-file**
 * path — only a changed file exists on the Files changed tab, and only a
 * changed file's line numbers are valid at the PR head (spec §10, "The
 * grounding allow-list"). The schema cannot express that; grounding does.
 */
export const ReviewFocus = z.object({
  file: z.string(),
  /**
   * A line inside a hunk of that file at the PR head. Optional per §10.
   *
   * `.nullish()`, NOT `.optional()`: this schema is handed to
   * `completeStructured`, which converts it via OpenAI's `zodResponseFormat`
   * in `strict: true` mode (`reviewer-core/src/llm/structured.ts:19-22`).
   * There, every property is required, and a bare `.optional()` is rejected —
   * the SDK warns "uses `.optional()` without `.nullable()` which is not
   * supported by the API … will become an error in a future version" and emits
   * a schema the API will not accept. `.nullish()` yields
   * `anyOf: [integer, null]`, which is what the shipped structured contracts
   * already do (`Intent.confidence`, `SmartDiffFile.pseudocode_summary`).
   */
  line: z.number().int().nullish(),
  reason: z.string(),
});
export type ReviewFocus = z.infer<typeof ReviewFocus>;

/**
 * The schema handed to `completeStructured` — the model's raw output, before
 * REQ-6 grounding and the REQ-7 lower-only cap.
 *
 * `risk_level` reuses the shared `RiskSeverity` enum: the spec's `high` /
 * `medium` / `low` vocabulary is the same one, and restating it would let the
 * two drift.
 */
export const ModelBrief = z.object({
  /** What the PR changes, in a reviewer's terms. One short paragraph. */
  what: z.string(),
  /** Why the change is being made. One short paragraph. */
  why: z.string(),
  /** Overall merge risk. Never defaulted on absence — see §10. */
  risk_level: RiskSeverity,
  /** Concrete risks, in the model's order. May be empty. */
  risks: z.array(Risk),
  /** What to read first, most important first. May be empty. */
  review_focus: z.array(ReviewFocus),
});
export type ModelBrief = z.infer<typeof ModelBrief>;

/**
 * The brief document as persisted in `pr_brief.json` — the same shape as the
 * model returned it, after grounding discarded out-of-allow-list references
 * (REQ-6) and the cap lowered `risk_level` where required (REQ-7). Same shape,
 * different provenance; the alias exists so call sites can say which one they
 * mean.
 */
export const BriefDocument = ModelBrief;
export type BriefDocument = z.infer<typeof BriefDocument>;

// ============================================================ Fingerprint

/**
 * REQ-8's state fingerprint, split in two halves (spec D-1a, plan BQ-1/A).
 *
 * All ten components enter the stored fingerprint and all ten are compared at
 * assembly. The split exists because only one half can be recomputed cheaply:
 *
 *  - `local`  — the PR head sha, the stored intent's derivation timestamp and
 *               model, the blast map's `indexed_sha` and `state`, the resolved
 *               feature-model provider and model, and the assembler version.
 *               All readable from our own database and settings, so the read
 *               path recomputes this half and this half only.
 *  - `remote` — the linked issue's number, state and content digest, plus the
 *               source identifier and content digest of every resolved
 *               reference document. Recomputing it means a live GitHub call
 *               and a set of clone reads on every PR open — the work D-14
 *               forbids and §7's 300 ms read budget cannot hold.
 *
 * **What that trades away:** an edited linked issue and an edited referenced
 * document are detected at the next *assembly*, never at the next *read*. Both
 * halves are digests, never input content.
 *
 * The pair is persisted in the single `pr_brief.state_fingerprint` text
 * column; no second column is needed.
 */
export const BriefFingerprint = z.object({
  local: z.string(),
  remote: z.string(),
});
export type BriefFingerprint = z.infer<typeof BriefFingerprint>;

/**
 * The locally recomputable fingerprint components, by name — the vocabulary
 * REQ-14 uses to say which inputs moved. Exhaustive over D-1a's `local` half,
 * so a marker can never name an input the read path cannot actually see move.
 */
export const MovedInput = z.enum([
  'head_sha',
  'intent_derived_at',
  'intent_model',
  'indexed_sha',
  'blast_state',
  'model_provider',
  'model_id',
  'assembler_version',
]);
export type MovedInput = z.infer<typeof MovedInput>;

// ============================================================ Provenance

/**
 * Which of the five inputs (§10, "Input provenance") contributed to an
 * assembly. Absence is recorded, not inferred: a PR that links nothing
 * contributes no `references` and that is the normal case, not a degradation.
 */
export const BriefInput = z.enum([
  /** The stored `pr_intent` row, read and never derived (D-12). */
  'intent',
  /** The blast map. An empty map is not the same as an absent one. */
  'blast',
  /** Diff statistics, changed-file paths and locally parsed hunk ranges. */
  'diff',
  /** `PrDetail.linked_issue`, resolved live and never persisted. */
  'linked_issue',
  /** Specification and plan documents resolved from the PR body (D-13). */
  'references',
]);
export type BriefInput = z.infer<typeof BriefInput>;

/**
 * A source identifier with why it did not make it in. The identifier is a
 * repository path, a `#N` reference or a URL — never document content.
 */
export const SkippedSource = z.object({
  source: z.string(),
  reason: z.string(),
});
export type SkippedSource = z.infer<typeof SkippedSource>;

/**
 * REQ-15's per-assembly record, stored in `pr_brief.provenance`.
 *
 * SAFETY CONTRACT, in the spirit of `modules/reviews/prompt-log.ts:6-21`:
 * every value here is a number, a fixed source label, a repository path or a
 * truncated digest. It carries **no input content** — never issue prose, never
 * document prose, never a diff line. There is no verbosity level that turns
 * content on. `server/test/brief-provenance.test.ts` asserts this against
 * planted secrets rather than trusting the comment.
 */
export const BriefProvenance = z.object({
  /** Which of the five sources contributed. */
  inputs_used: z.array(BriefInput),
  /** Source identifiers of the reference documents that resolved. */
  references_used: z.array(z.string()),
  /** Source identifiers that were linked but not read, each with a reason. */
  references_skipped: z.array(SkippedSource),
  /** Whole items dropped to fit the token budget, in D-8's order, by source. */
  dropped_items: z.array(SkippedSource),
  /** Our own pre-call estimate — judged against `tokens_in` below. */
  estimated_input_tokens: z.number().int().nonnegative(),
  /** The provider's own counts. Null when the provider reported none. */
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  /** Read from the provider result, never recomputed. */
  cost_usd: z.number().nullable(),
  /** References discarded by REQ-6 grounding. Never repaired or fuzzy-matched. */
  discarded_refs: z.number().int().nonnegative(),
  /** The resolved feature model that produced the brief. */
  model: z.string().nullable(),
});
export type BriefProvenance = z.infer<typeof BriefProvenance>;

// ============================================================ HTTP envelope

/**
 * The brief as served — §10's field table in full: the grounded document, plus
 * the fingerprint, the provenance, the cost and the read-path freshness
 * marker.
 *
 * Built with `.extend()` on `ModelBrief` so the relationship is explicit: the
 * document half of the envelope IS the model's shape, after grounding.
 */
export const BriefResponse = ModelBrief.extend({
  /** Both halves; only `local` is recomputed on the read path (D-1a). */
  state_fingerprint: BriefFingerprint,
  inputs_used: z.array(BriefInput),
  references_used: z.array(z.string()),
  references_skipped: z.array(SkippedSource),
  discarded_refs: z.number().int().nonnegative(),
  /** Null → the card shows "—", via the shipped `formatCost`; never "$0.00". */
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  /**
   * When the model was called. Under D-1a this is the only thing that dates
   * the linked issue and the reference documents the brief read, so the card
   * must render it — never "just now".
   */
  generated_at: z.string(),
  /** REQ-14: a locally recomputable component differs from the stored one. */
  out_of_date: z.boolean(),
  /** Which ones. Empty whenever `out_of_date` is false. */
  moved_inputs: z.array(MovedInput),
});
export type BriefResponse = z.infer<typeof BriefResponse>;
