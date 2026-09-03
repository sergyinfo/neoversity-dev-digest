/**
 * L06 — the Eval Pipeline module-local shapes: what an eval case EXPECTS, what
 * a run ACTUALLY produced, and the two request bodies.
 *
 * MODULE-LOCAL ON PURPOSE (plan S1), for the reason already recorded twice —
 * see `server/src/modules/blast/contract.ts:1-26`,
 * `server/src/modules/project-context/contract.ts:1-22` and `server/INSIGHTS.md`
 * (2026-08-23): no route in this server declares a Zod `response:` schema, so
 * responses are typed by TypeScript return annotations and are never validated
 * on the way out. Putting these in `@devdigest/shared` would buy types only, at
 * the cost of entering a do-not-touch zone and widening the
 * two-vendored-copies byte-identity surface.
 *
 * What IS shared is reused rather than restated: `Finding`, `Severity` and
 * `FindingCategory` come from `@devdigest/shared` (`contracts/findings.ts`), and
 * the persisted row/dashboard shapes (`EvalCase`, `EvalRun`, `EvalRunRecord`,
 * `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard`) already exist there and
 * are consumed as given. Nothing here duplicates them.
 *
 * These schemas exist because the two `eval_cases` / `eval_runs` jsonb columns
 * the feature hangs off — `expected_output` and `actual_output` — are
 * `z.unknown()` in the given contract (`contracts/eval-ci.ts`,
 * `contracts/knowledge.ts`). This file is the declared SOURCE OF TRUTH for what
 * actually goes in them: the run loop writes these shapes and the compare modal
 * reads them, and without a named schema the two would agree only by accident.
 */
import { z } from 'zod';
import { Finding, Severity, FindingCategory } from '@devdigest/shared';

// ===========================================================================
// expected_output — what the case asserts
// ===========================================================================

/**
 * The agent SHOULD produce a finding here. Derived server-side from a finding
 * the reviewer accepted (`findings.accepted_at`), never accepted from a client.
 *
 * `severity`, `category` and `title` are carried for display and for future
 * tightening of the match rule; they are NOT part of the match today, which is
 * `file` equality plus line-range overlap (spec §Scoring). They are `nullish`
 * rather than required because the expectation survives its source finding
 * (Edge-3: deleting the finding must not invalidate the case), so a case whose
 * origin row is gone still parses.
 *
 * `start_line`/`end_line` are plain `.int()`, deliberately matching
 * `Finding.start_line` in `@devdigest/shared` rather than being stricter. A
 * tighter bound here than on the source shape would let the server write an
 * expectation it could not read back.
 */
export const MustFindExpectation = z.object({
  kind: z.literal('must_find'),
  file: z.string().min(1),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type MustFindExpectation = z.infer<typeof MustFindExpectation>;

/**
 * The agent SHOULD NOT produce a finding here. Derived from a dismissed finding
 * (`findings.dismissed_at`).
 *
 * File and range ONLY — no severity/category/title. A dismissal says "nothing
 * worth reporting lives on these lines"; it does not say "nothing of THIS
 * severity". Carrying the source finding's severity would invite a future match
 * rule that only counts a false positive when the severities happen to agree,
 * which is not what a reviewer meant when they hit Dismiss (spec §Contracts).
 */
export const MustNotFlagExpectation = z.object({
  kind: z.literal('must_not_flag'),
  file: z.string().min(1),
  start_line: z.number().int(),
  end_line: z.number().int(),
});
export type MustNotFlagExpectation = z.infer<typeof MustNotFlagExpectation>;

/**
 * One assertion in a case. A discriminated union on `kind` rather than a single
 * object with an optional-everything shape: the scorer branches on `kind` for
 * both recall and precision, and the union makes that branch exhaustive at the
 * type level instead of a runtime string compare on a `string` field.
 */
export const EvalExpectation = z.discriminatedUnion('kind', [
  MustFindExpectation,
  MustNotFlagExpectation,
]);
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * The whole of `eval_cases.expected_output`.
 *
 * An object wrapping the array, not a bare array: the column is jsonb and this
 * is the one shape in the feature that is written once and read for the life of
 * the case, so it needs room to grow a sibling key without a rewrite of every
 * stored row.
 */
export const ExpectedOutput = z.object({
  expectations: z.array(EvalExpectation),
});
export type ExpectedOutput = z.infer<typeof ExpectedOutput>;

// ===========================================================================
// actual_output — the self-describing run envelope
// ===========================================================================

/**
 * One linked skill, as it was AT RUN TIME (REC-6).
 *
 * `content_hash` is required, and it is the whole point of this shape: a run
 * that records skill ids and names only says WHICH skills were linked, not what
 * they SAID. Two runs a week apart can show an identical snapshot and still
 * differ because a skill body changed underneath (spec open question 3). The
 * hash is what lets the compare modal say "the prompts are identical, a skill
 * changed" instead of reporting an unexplained metric move.
 *
 * THERE IS NO `slug` COLUMN ON `skills` — `server/src/db/schema/skills.ts:5-21`
 * is `id, workspaceId, name, description, type, source, body, enabled, version`.
 * The word "slug" in `contracts/eval-ci.ts` refers to a CI manifest, not this
 * database. The key is `{ id, name, version, content_hash }`; `version` is
 * already bumped on every edit and comes free as a second staleness signal.
 */
export const EvalSkillSnapshot = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int(),
  content_hash: z.string().min(1),
});
export type EvalSkillSnapshot = z.infer<typeof EvalSkillSnapshot>;

/**
 * The agent as it was AT RUN TIME.
 *
 * `id` and `name` are required per REC-1 and are not decoration: the given
 * `EvalRunRecord` carries no agent field at all, so the workspace dashboard's
 * "recent runs across all agents" table cannot say which agent a row belongs to
 * without reading it from here.
 *
 * `system_prompt` is stored in full rather than hashed — the compare modal
 * renders a line-level diff of two batches' prompts, which a hash cannot
 * reconstruct.
 */
export const EvalAgentSnapshot = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  system_prompt: z.string(),
  model: z.string(),
  skills: z.array(EvalSkillSnapshot),
});
export type EvalAgentSnapshot = z.infer<typeof EvalAgentSnapshot>;

/**
 * The scorer's verdict on one expectation, by INDEX into
 * `ExpectedOutput.expectations`.
 *
 * By index rather than by a copy of the expectation, so the envelope stays
 * small and cannot disagree with the case it was scored against. `finding_id`
 * is `null` for an unmatched expectation — a `must_find` that was missed, or a
 * `must_not_flag` that was correctly left alone — which is why the key is
 * present-and-null rather than absent.
 */
export const EvalMatch = z.object({
  expectation_index: z.number().int().nonnegative(),
  finding_id: z.string().nullable(),
});
export type EvalMatch = z.infer<typeof EvalMatch>;

/**
 * The whole of `eval_runs.actual_output`. This envelope is what makes a run
 * self-describing and comparable without a schema change (spec §Contracts).
 *
 * `batch_id` groups the rows of ONE run of the whole set. It lives inside the
 * jsonb because the tables ship in `0000_init.sql` and this feature adds no
 * column (spec open question 1: if grouping over hundreds of runs gets slow the
 * honest fix is a real column, not a cleverer query).
 *
 * `findings` is what the agent produced AS-IS — the pre-grounding set — while
 * `grounded_ids` names the subset that survived the grounding gate. Both are
 * kept because they answer different questions: scoring runs over the grounded
 * set (BQ-6a), and `citation_accuracy` is the share that survived. Storing only
 * the survivors would make the metric unreconstructable from the row.
 *
 * An empty `findings` array is VALID and meaningful, not a failure to record:
 * an agent that produced nothing scores recall 0 with precision and
 * citation_accuracy 1 (spec Edge-2).
 */
export const ActualOutput = z.object({
  batch_id: z.string().min(1),
  findings: z.array(Finding),
  grounded_ids: z.array(z.string()),
  matches: z.array(EvalMatch),
  agent: EvalAgentSnapshot,
});
export type ActualOutput = z.infer<typeof ActualOutput>;

// ===========================================================================
// Request bodies
// ===========================================================================

/**
 * `POST /findings/:id/eval-case`.
 *
 * `agent_id` is the SECOND of three owner sources (BQ-2a): the route prefers
 * `review.agent_id`, falls back to this, and 422s naming the reason when
 * neither is available. It is optional because the first branch is the normal
 * one — the client sends this only when the review it is looking at has a null
 * `agent_id`, which the seeded demo review does.
 *
 * `.uuid()` per the `IdParams` convention (`_shared/schemas.ts:11`): the value
 * flows into `eq()` against a `uuid` column, where a malformed one is Postgres
 * 22P02 — a 500 echoing raw database text — instead of a clean 422.
 *
 * The body itself is optional. A one-click affordance legitimately posts with
 * no body at all, and `.nullish()` + a normalising transform means the handler
 * always destructures an object rather than guarding for `undefined`.
 */
export const CreateEvalCaseBody = z
  .object({ agent_id: z.string().uuid().optional() })
  .nullish()
  .transform((b) => b ?? {});
export type CreateEvalCaseBody = z.infer<typeof CreateEvalCaseBody>;

/**
 * `POST /agents/:id/eval-runs`.
 *
 * Deliberately empty and tolerant: everything the run needs is already stored —
 * the agent comes from `:id` and the inputs come from the cases (AC-6/AC-7, no
 * live repo, PR or index read). There is no knob here on purpose; accepting one
 * would be the first step towards a run that reads something it should not.
 *
 * Tolerant in both directions: no body at all parses, and unknown keys are
 * stripped rather than rejected, so a client that posts `{}` or a stray field
 * gets a run instead of a 422 over a payload that was never read.
 */
export const RunEvalBody = z
  .object({})
  .nullish()
  .transform(() => ({}) as Record<string, never>);
export type RunEvalBody = z.infer<typeof RunEvalBody>;

// ===========================================================================
// Batch summary — the unit of comparison (BQ-4a)
// ===========================================================================

/**
 * One BATCH: the aggregate of every `eval_runs` row sharing a `batch_id`.
 *
 * The batch, not the individual run, is the unit the product compares (BQ-4a) —
 * `GET /agents/:id/eval-runs` returns these, and Compare takes exactly two
 * `batch_id`s. The three metrics are averaged across the batch's rows;
 * `traces_passed`/`traces_total` are batch-level counts, which is also how a
 * PARTIAL batch reports itself: a run that threw mid-set leaves the rows it had
 * already written and `traces_total` comes back below the case count (Edge-7).
 *
 * `agent` is nullable, and only because it is aggregated out of untyped jsonb:
 * the run loop always writes a snapshot, but a hand-seeded or pre-envelope row
 * need not have one. A consumer must render "snapshot unavailable" for null
 * rather than an empty prompt diff — a blank diff reads as "the prompts are
 * identical", which is the one wrong conclusion available here.
 */
export const EvalBatchSummary = z.object({
  batch_id: z.string().min(1),
  ran_at: z.string(),
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int().nonnegative(),
  traces_total: z.number().int().nonnegative(),
  /** Null when no row in the batch recorded a cost, matching `EvalRunRecord`. */
  cost_usd: z.number().nullable(),
  agent: EvalAgentSnapshot.nullable(),
  /**
   * REC-2, per BATCH: nothing this batch produced landed on a labelled line, so
   * `precision` above is 1 by the `TP + FP = 0` rule rather than by merit and a
   * reader must be shown "n/a", not a flattering 100%.
   *
   * It cannot be inferred from `precision === 1` (that is the whole point — a
   * genuinely perfect batch reports the same number), and it cannot be read off
   * the workspace-level `alert`, which is derived from the newest batch across
   * ALL agents and so cannot annotate one agent's row or one older batch. The
   * server re-derives it with the scorer's own `classifyFindings` over the
   * batch's stored envelopes.
   */
  precision_undefined: z.boolean(),
});
export type EvalBatchSummary = z.infer<typeof EvalBatchSummary>;
