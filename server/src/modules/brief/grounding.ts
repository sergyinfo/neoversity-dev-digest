/**
 * L05 — REQ-6's grounding allow-list and discard filter, and REQ-7's lower-only
 * risk cap.
 *
 * PURE BY DESIGN: no container, no I/O, no `platform/` import. Everything it
 * needs arrives as data, which is what lets the whole of REQ-6 and REQ-7 be
 * tested without a database or a model.
 *
 * The rule this module exists to enforce, stated once:
 *
 *   **A reference the model returns is either something we observed, or it is
 *   discarded.** It is never repaired, fuzzy-matched or substituted. Repairing
 *   `src/api/user.ts` to the `src/api/users.ts` that happens to be in the diff
 *   does not fix a wrong claim — it silently asserts a DIFFERENT one, over a
 *   file the model never reasoned about, and the reader has no way to tell.
 *   Losing an entry is visible (the discard count says so); a repaired entry
 *   is not.
 *
 * Two asymmetries in the allow-list are deliberate (spec §10):
 *
 *  - `review_focus[].file` may be a **changed file only**. A review-focus entry
 *    is a click through to the Files changed tab, and only a changed file exists
 *    there; its line numbers are valid at the PR head, whereas a blast caller's
 *    line is valid at `indexed_sha` — a different tree, which can lag the head
 *    by tens of commits (`server/INSIGHTS.md`, 2026-08-23).
 *  - `risks[].file_refs` may span the WHOLE allow-list, because "this breaks a
 *    caller in `src/server.ts`" is exactly the kind of risk the blast map exists
 *    to make sayable.
 *
 * And one thing the allow-list deliberately does not contain: **anything a
 * reference document mentions**. `buildAllowList` takes no documents parameter
 * at all — that absence IS the enforcement. A path named inside a spec is a
 * claim someone wrote down, not an observation, and the documents are the least
 * trustworthy input in the assembly.
 */
import { RiskSeverity, type Risk } from '@devdigest/shared';
import type { BlastResponse } from '../blast/contract.js';
import type { BriefDocument, ModelBrief, ReviewFocus } from './contract.js';

/**
 * The two tiers of the allow-list. Kept as one object rather than two loose
 * sets so a caller cannot pass them the wrong way round — `changedFiles` is a
 * subset of `all`, and swapping the arguments would widen review-focus grounding
 * to the entire dependency graph without any type error.
 */
export interface AllowList {
  /** Every observed path or identifier. Risks may cite any of these. */
  readonly all: ReadonlySet<string>;
  /** The PR's changed file paths. Only these may appear in `review_focus`. */
  readonly changedFiles: ReadonlySet<string>;
}

/**
 * The blast facts the allow-list is built from. Structural rather than the full
 * `BlastResponse` so a test can state the six contributing fields and nothing
 * else, and so this module never depends on the envelope's HTTP fields.
 */
export type BlastGrounding = Pick<BlastResponse, 'map' | 'prior_prs'>;

/**
 * The union defined by §10: changed file paths, plus the blast map's
 * `changed_symbols[].file`, `downstream[].callers[].file`,
 * `downstream[].endpoints_affected`, `downstream[].crons_affected`, and
 * `prior_prs[].overlapping_files`.
 *
 * Endpoints and crons are strings rather than paths (`GET /pulls/:id`,
 * `nightly-digest`) and are allow-listed as they are: a risk that says "this
 * reaches `GET /pulls/:id`" is grounded in the same index that produced the
 * map, and the filter is exact-match either way.
 *
 * Empty and absent blast maps are the same input here and both are normal — a
 * degraded index leaves the changed-file list as the whole allow-list, which is
 * a narrower brief, not a broken one.
 */
export function buildAllowList(
  changedFiles: readonly string[],
  blast: BlastGrounding | null | undefined,
): AllowList {
  const changed = new Set<string>();
  for (const path of changedFiles) {
    const p = path.trim();
    if (p) changed.add(p);
  }

  const all = new Set<string>(changed);
  if (blast) {
    for (const s of blast.map.changed_symbols) add(all, s.file);
    for (const d of blast.map.downstream) {
      for (const c of d.callers) add(all, c.file);
      for (const e of d.endpoints_affected) add(all, e);
      for (const c of d.crons_affected) add(all, c);
    }
    for (const pr of blast.prior_prs) {
      for (const f of pr.overlapping_files) add(all, f);
    }
  }

  return { all, changedFiles: changed };
}

function add(set: Set<string>, value: string | null | undefined): void {
  const v = value?.trim();
  if (v) set.add(v);
}

export interface GroundingResult {
  /** The model's document with every ungrounded reference removed. */
  document: BriefDocument;
  /**
   * How many references were discarded — dropped `file_refs` entries plus
   * dropped `review_focus` entries. REQ-15 records it, and it is the earliest
   * signal that the prompt or the model has gone wrong.
   */
  discarded: number;
}

/**
 * Apply REQ-6 to a model brief, then REQ-7 to what survived.
 *
 * A risk whose every `file_ref` was discarded is KEPT, with an empty
 * `file_refs`. REQ-6 discards a *reference*, not a risk: "this change can break
 * callers" is still a real thing to have said, and deleting the risk because
 * the model mis-typed its path would let a bad path suppress a finding — the
 * suppression channel intent's scope rules already close
 * (`intent/constants.ts:38-45`).
 *
 * A `review_focus` entry, by contrast, is dropped whole when its file is not a
 * changed file: the entry IS a pointer at a file, and a pointer at nothing is
 * not an entry. Nothing is substituted in its place — when every entry goes,
 * the list is empty and the card renders its empty state (AC-15).
 */
export function filterReferences(brief: ModelBrief, allow: AllowList): GroundingResult {
  let discarded = 0;

  const risks: Risk[] = brief.risks.map((risk) => {
    const file_refs = risk.file_refs.filter((ref) => allow.all.has(ref));
    discarded += risk.file_refs.length - file_refs.length;
    return { ...risk, file_refs };
  });

  const review_focus: ReviewFocus[] = brief.review_focus.filter((entry) =>
    allow.changedFiles.has(entry.file),
  );
  discarded += brief.review_focus.length - review_focus.length;

  return {
    document: {
      ...brief,
      risks,
      review_focus,
      risk_level: capRiskLevel(brief.risk_level, risks),
    },
    discarded,
  };
}

const SEVERITY_RANK: Record<RiskSeverity, number> = { low: 0, medium: 1, high: 2 };

/**
 * REQ-7: the model's `risk_level` may be lowered to the highest severity among
 * the risks that survived grounding, and may never be raised.
 *
 * The direction is the whole point, and it mirrors intent's
 * `confidence = min(model band, evidence tier)` (`intent/classifier.ts:120-132`):
 * our code may only ever lower the model's claim. Raising it would mean
 * asserting a level no listed risk supports — "high risk, no risks listed" is
 * the shape of an anxious model, not of a dangerous PR.
 *
 * Two rules that look like edge cases and are not:
 *
 *  - **No surviving risks → `low`.** A brief that says "high" while listing
 *    nothing gives the reader no way to act.
 *  - **A risk whose own `severity` fails validation is excluded from the max.**
 *    `ModelBrief` is parsed upstream, so this cannot normally happen — but the
 *    property being defended is a SAFETY property, and a safety property that
 *    holds only because some other function ran first is not one. Excluding the
 *    invalid risk means a malformed severity can never RAISE the level; it is
 *    still kept in the document, where a reader can see it.
 */
export function capRiskLevel(
  modelLevel: RiskSeverity,
  survivingRisks: readonly Risk[],
): RiskSeverity {
  let highest: RiskSeverity | null = null;
  for (const risk of survivingRisks) {
    const parsed = RiskSeverity.safeParse(risk.severity);
    if (!parsed.success) continue;
    if (highest === null || SEVERITY_RANK[parsed.data] > SEVERITY_RANK[highest]) {
      highest = parsed.data;
    }
  }

  if (highest === null) return 'low';
  return SEVERITY_RANK[modelLevel] > SEVERITY_RANK[highest] ? highest : modelLevel;
}
