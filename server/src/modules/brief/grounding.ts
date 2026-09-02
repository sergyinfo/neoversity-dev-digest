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
 *  - `review_focus[].file` may be a **changed file only**, and its `line` must
 *    fall inside one of that file's `@@` ranges. A review-focus entry is a click
 *    through to the Files changed tab, and only a changed file exists there; its
 *    line numbers are valid at the PR head, whereas a blast caller's line is
 *    valid at `indexed_sha` — a different tree, which can lag the head by tens
 *    of commits (`server/INSIGHTS.md`, 2026-08-23).
 *  - `risks[].file_refs` may span the WHOLE allow-list, because "this breaks a
 *    caller in `src/server.ts`" is exactly the kind of risk the blast map exists
 *    to make sayable — and may carry a `:line` suffix, which is checked as a
 *    path and then left alone for the reasons on `groundedRef` below.
 *
 * And one thing the allow-list deliberately does not contain: **anything a
 * reference document mentions**. `buildAllowList` takes no documents parameter
 * at all — that absence IS the enforcement. A path named inside a spec is a
 * claim someone wrote down, not an observation, and the documents are the least
 * trustworthy input in the assembly.
 */
import { RiskSeverity, type Risk } from '@devdigest/shared';
import type { BlastResponse } from '../blast/contract.js';
import { headLineRanges, type HeadLineRange } from './assemble.js';
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
  /**
   * Per changed file, the head-side line spans of its hunks — the same ranges
   * the assembler rendered into the prompt. A `review_focus[].line` outside
   * every span of its own file is not grounded.
   *
   * A file with no readable patch (binary, unfetched) maps to an EMPTY array,
   * and that is not the same as "unconstrained": the model was shown no ranges
   * for it either, so it has no grounds for any line on it.
   */
  readonly headLines: ReadonlyMap<string, readonly HeadLineRange[]>;
}

/**
 * One changed file as grounding needs it: the path, and the hunk-only patch the
 * assembler rendered `@@` ranges from.
 *
 * Structural, like `BlastGrounding` below — `assemble.ts`'s `BriefChangedFile`
 * satisfies it, so the service hands over the very files that reached the model
 * rather than a separately-derived list that could disagree with them.
 */
export interface ChangedFileGrounding {
  path: string;
  /** The stored hunk-only patch. Null for a binary or unfetched file. */
  patch?: string | null;
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
  changedFiles: readonly ChangedFileGrounding[],
  blast: BlastGrounding | null | undefined,
): AllowList {
  const changed = new Set<string>();
  const headLines = new Map<string, readonly HeadLineRange[]>();
  for (const file of changedFiles) {
    const p = file.path.trim();
    if (!p) continue;
    changed.add(p);
    headLines.set(p, headLineRanges(file.patch));
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

  return { all, changedFiles: changed, headLines };
}

function add(set: Set<string>, value: string | null | undefined): void {
  const v = value?.trim();
  if (v) set.add(v);
}

export interface GroundingResult {
  /** The model's document with every ungrounded reference removed. */
  document: BriefDocument;
  /**
   * How many references were discarded — dropped `file_refs` entries, dropped
   * `review_focus` entries, and `review_focus` lines cleared for falling
   * outside their file's hunks. REQ-15 records it, and it is the earliest
   * signal that the prompt or the model has gone wrong.
   */
  discarded: number;
}

/**
 * Split a trailing `:<line>` off a `file_refs` entry.
 *
 * The dependency map the model is shown renders a caller as
 * `called from src/server.ts:12 (bootstrap)` (`blast/summary.ts:76`), so a model
 * copying a reference straight out of it writes `src/server.ts:12`. Matching
 * that whole string against an allow-list of BARE paths discarded it and counted
 * it into `discarded_refs` — the prompt taught the model a form the filter then
 * rejected. The line is kept on the surviving entry: the client parses it back
 * out (`WhyRiskCard/constants.ts` `splitFileRef`) to open the file at it.
 *
 * The full string is tested against the allow-list FIRST, so an endpoint or a
 * cron whose own name ends in `:<digits>` is matched as itself rather than
 * being split into a path it is not.
 *
 * The line is NOT range-checked, unlike `review_focus[].line`: a `file_refs`
 * entry may name a blast caller, whose line is valid at `indexed_sha` — a
 * different tree from the PR head, with no hunks of ours to check it against.
 */
function groundedRef(ref: string, allow: AllowList): boolean {
  if (allow.all.has(ref)) return true;
  const m = /^(.*):(\d+)$/.exec(ref);
  return m !== null && allow.all.has(m[1]!);
}

/** Whether `line` falls inside one of that file's head-side hunk spans. */
function lineIsInAHunk(file: string, line: number, allow: AllowList): boolean {
  if (!Number.isSafeInteger(line)) return false;
  const ranges = allow.headLines.get(file) ?? [];
  return ranges.some((r) => line >= r.start && line <= r.end);
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
 *
 * An entry whose file IS a changed file but whose `line` falls outside every
 * hunk of it has the LINE CLEARED and the entry kept. Dropping it whole would
 * be the wrong trade in the opposite direction from the paragraph above: here
 * the file really is a grounded pointer and `reason` is real prose about it, so
 * discarding the entry over a bad line would let a mis-numbered line suppress a
 * "read this first". Clearing the line removes exactly the ungrounded part and
 * keeps the grounded one — the same lower-only shape as REQ-7's risk cap, and
 * why `reason` is never rendered beside a line we could not stand behind.
 */
export function filterReferences(brief: ModelBrief, allow: AllowList): GroundingResult {
  let discarded = 0;

  const risks: Risk[] = brief.risks.map((risk) => {
    const file_refs = risk.file_refs.filter((ref) => groundedRef(ref, allow));
    discarded += risk.file_refs.length - file_refs.length;
    return { ...risk, file_refs };
  });

  const kept = brief.review_focus.filter((entry) => allow.changedFiles.has(entry.file));
  discarded += brief.review_focus.length - kept.length;

  const review_focus: ReviewFocus[] = kept.map((entry) => {
    if (entry.line == null) return entry;
    if (lineIsInAHunk(entry.file, entry.line, allow)) return entry;
    discarded++;
    return { ...entry, line: null };
  });

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
