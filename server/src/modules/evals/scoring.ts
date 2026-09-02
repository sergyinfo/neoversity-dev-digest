/**
 * L06 — the deterministic scorer (plan S2).
 *
 * ## The iron rule of this file
 *
 * **It is pure.** No database, no container, no `node:fs`, no LLM, no clock, no
 * randomness — nothing with I/O is imported here, and the only imports are
 * TYPES. That is not a stylistic preference: the spec's whole premise is that
 * "the measurement itself must be boring and free", and `verify:l06` (S13,
 * REC-4) greps this file's stripped source for `container.llm` / `.complete(` /
 * `completeStructured`. A model call in the scoring path is a defect, not a
 * design choice, because a judge model would make two runs of the same stored
 * inputs disagree — which is precisely the property the eval pipeline exists to
 * provide.
 *
 * Because it is pure it is also synchronous and unit-testable without Postgres:
 * `server/test/evals-scoring.test.ts` names one test per spec edge case and is
 * the cheapest file in the suite.
 *
 * ## Two counting bases, on purpose
 *
 * The spec defines recall over EXPECTATIONS and precision over FINDINGS, and
 * those are genuinely different questions, so this file computes two things:
 *
 *  - `matchFindings` — a greedy ONE-TO-ONE assignment of expectations to
 *    findings. It answers "which expectations were satisfied?" and is what
 *    `recall`, `pass` and the stored `matches[]` envelope read. One-to-one is
 *    the point of Edge-6: two expectations on the same lines must not both be
 *    satisfied by a single finding.
 *  - `classifyFindings` — a per-finding label (TP / FP / ignored). It answers
 *    "of the findings the agent produced, how many landed on labelled lines?"
 *    and is what `precision` reads. Counting expectations here instead would
 *    under-report false positives: three findings piled on one `must_not_flag`
 *    range are three false positives, not one.
 */
import type { Finding } from '@devdigest/shared';
import type { EvalExpectation, EvalMatch } from './contract.js';

/**
 * The overlap rule, verbatim from the spec: `a.start <= b.end AND b.start <= a.end`.
 *
 * Inclusive on both ends, so a one-line finding at 10 overlaps an expectation
 * covering 10–10. Adjacency is NOT overlap (Edge-4): 10–12 and 13–15 do not
 * match, and that strictness is deliberate — "a finding two lines away is a
 * different finding".
 */
export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** File equality is EXACT (Edge-5: a renamed file is not a match). */
function sameLocation(expectation: EvalExpectation, finding: Finding): boolean {
  return (
    expectation.file === finding.file &&
    overlaps(
      { start: expectation.start_line, end: expectation.end_line },
      { start: finding.start_line, end: finding.end_line },
    )
  );
}

/**
 * Byte comparison, NOT `localeCompare`.
 *
 * `localeCompare` consults the runtime's collation, so its answer for two file
 * paths or two finding ids can differ between machines with different `LANG`
 * settings. A scorer whose output depends on an environment variable is not the
 * deterministic scorer this file promises to be.
 */
function byBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `must_find` is walked before `must_not_flag` — see `matchFindings`. Any new
 * expectation kind must be given a rank here deliberately, not inherit one.
 */
const KIND_RANK: Record<EvalExpectation['kind'], number> = {
  must_find: 0,
  must_not_flag: 1,
};

/**
 * Greedy expectation → finding assignment.
 *
 * Returns one `EvalMatch` per expectation, in the expectations' ORIGINAL order,
 * because `EvalMatch.expectation_index` indexes back into the stored
 * `ExpectedOutput.expectations` array (contract.ts) and the envelope would be
 * unreadable if the indices were the sorted ones.
 *
 * ## The walk order, and what it buys
 *
 * BOTH sides are walked in a content-derived order, never in array order:
 *
 *  - expectations by `(kind, file, start_line, end_line)`
 *  - findings by `(file, start_line, end_line, id)`
 *
 * so which finding satisfies which expectation depends on what the inputs SAY,
 * not on the order they happened to arrive in. Ties fall back to the original
 * index, and a tie means the two entries are interchangeable under the match
 * rule anyway. (The findings half of this was missing: the inner loop used to
 * walk `findings` in array order, so re-ordering two findings that both overlap
 * one expectation changed the stored `finding_id`.)
 *
 * `kind` leads, so `must_find` claims before `must_not_flag`. That is what keeps
 * this function agreeing with `classifyFindings`, which deliberately lets
 * `must_find` win a finding overlapping both kinds: without it, expectations
 * `[must_not_flag a.ts 10-20, must_find a.ts 10-20]` and one finding at
 * `a.ts:15` produced `pass: false` while precision scored the very same finding
 * `tp` — one row, two numbers, disagreeing about one finding — and merely
 * swapping the two array positions flipped `pass`. It also removes the need for
 * the seed's data-side workaround ("no case ever asks the agent to both find and
 * not find the same lines").
 *
 * The agreement is NOT total, and this file does not claim it is: greedy
 * one-to-one can still hand a `must_not_flag` a *different* finding that also
 * overlaps a `must_find`, when that `must_find` has already claimed another one.
 * The two functions answer different questions (see the header); what is
 * guaranteed is that a finding a `must_find` can still claim is never taken by a
 * `must_not_flag` first.
 *
 * A finding, once claimed, is not offered to any later expectation (Edge-6).
 */
export function matchFindings(
  expectations: readonly EvalExpectation[],
  findings: readonly Finding[],
): EvalMatch[] {
  const matches: EvalMatch[] = expectations.map((_, i) => ({
    expectation_index: i,
    finding_id: null,
  }));

  const order = expectations
    .map((expectation, index) => ({ expectation, index }))
    .sort(
      (a, b) =>
        KIND_RANK[a.expectation.kind] - KIND_RANK[b.expectation.kind] ||
        byBytes(a.expectation.file, b.expectation.file) ||
        a.expectation.start_line - b.expectation.start_line ||
        a.expectation.end_line - b.expectation.end_line ||
        a.index - b.index,
    );

  const candidates = findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        byBytes(a.finding.file, b.finding.file) ||
        a.finding.start_line - b.finding.start_line ||
        a.finding.end_line - b.finding.end_line ||
        byBytes(a.finding.id, b.finding.id) ||
        a.index - b.index,
    );

  // Claims are keyed by the finding's ORIGINAL index, so the sort above changes
  // only which finding is offered first, never which set is available.
  const claimed = new Set<number>();
  for (const { expectation, index } of order) {
    for (const candidate of candidates) {
      if (claimed.has(candidate.index)) continue;
      if (!sameLocation(expectation, candidate.finding)) continue;
      claimed.add(candidate.index);
      matches[index]!.finding_id = candidate.finding.id;
      break;
    }
  }
  return matches;
}

/** Per-finding label, used only by `precision`. */
export type FindingLabel = 'tp' | 'fp' | 'ignored';

/**
 * Label every produced finding against the WHOLE expectation set.
 *
 * `must_find` wins when a finding overlaps both kinds: reporting something a
 * reviewer explicitly asked to keep seeing is a true positive, and letting an
 * adjacent dismissal turn it into a false positive would punish the exact
 * behaviour the case was created to reward.
 *
 * A finding matching neither kind is `ignored`, per the spec: "the dataset makes
 * no claim about them, and counting them would punish the agent for correctly
 * reporting something nobody has labelled yet."
 */
export function classifyFindings(
  expectations: readonly EvalExpectation[],
  findings: readonly Finding[],
): FindingLabel[] {
  return findings.map((finding) => {
    let flagged = false;
    for (const expectation of expectations) {
      if (!sameLocation(expectation, finding)) continue;
      if (expectation.kind === 'must_find') return 'tp';
      flagged = true;
    }
    return flagged ? 'fp' : 'ignored';
  });
}

export interface ScoreInput {
  /** The case's stored expectations (`ExpectedOutput.expectations`). */
  expectations: readonly EvalExpectation[];
  /** The POST-grounding findings (BQ-6a: `outcome.review.findings`). */
  findings: readonly Finding[];
  /** How many findings survived the grounding gate. */
  keptCount: number;
  /** How many the gate dropped (`outcome.dropped.length`). */
  droppedCount: number;
}

export interface ScoreResult {
  recall: number;
  precision: number;
  citation_accuracy: number;
  pass: boolean;
  matches: EvalMatch[];
  /** True positives — findings landing on a `must_find` expectation. */
  tp: number;
  /** False positives — findings landing on a `must_not_flag` expectation. */
  fp: number;
  /**
   * `TP + FP === 0`, i.e. nothing the agent produced touched a labelled line.
   *
   * REC-2 / spec open question 2: `precision` is 1 in that case by rule, and
   * rendering that as "100%" is flattering nonsense. The caller (the dashboard)
   * turns this flag into "n/a" and an `alert`. It is returned rather than
   * inferred from `precision === 1`, which cannot tell a real perfect score
   * from a vacuous one.
   */
  precision_undefined: boolean;
}

/**
 * Score one case. Every division rule below is the spec's, decided by rule
 * rather than by floating point — there is no `0/0` anywhere in this function.
 */
export function score(input: ScoreInput): ScoreResult {
  const { expectations, findings, keptCount, droppedCount } = input;

  const matches = matchFindings(expectations, findings);
  const labels = classifyFindings(expectations, findings);

  // ---- recall: over must_find EXPECTATIONS -------------------------------
  const mustFind = expectations
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.kind === 'must_find');
  const mustFindMatched = mustFind.filter(({ i }) => matches[i]!.finding_id !== null).length;
  // "SHALL be 1 when the set contains no must_find expectation" — a set of pure
  // must-not-flag cases cannot fail on recall.
  const recall = mustFind.length === 0 ? 1 : mustFindMatched / mustFind.length;

  // ---- precision: over produced FINDINGS ---------------------------------
  const tp = labels.filter((l) => l === 'tp').length;
  const fp = labels.filter((l) => l === 'fp').length;
  const precisionUndefined = tp + fp === 0;
  const precision = precisionUndefined ? 1 : tp / (tp + fp);

  // ---- citation accuracy: the grounding gate's own numbers ----------------
  // Taken from `reviewPullRequest`'s outcome (kept vs dropped) — groundFindings
  // is NEVER called a second time. 1 when the agent produced nothing: an agent
  // that says nothing has cited nothing wrongly (spec Edge-2).
  const produced = keptCount + droppedCount;
  const citationAccuracy = produced === 0 ? 1 : keptCount / produced;

  // ---- pass: both halves, over EXPECTATIONS -------------------------------
  // Literally the spec: "every must_find expectation matched AND no
  // must_not_flag expectation matched". Read off the one-to-one assignment, so
  // `pass` can never disagree with the `matches[]` the row stores next to it.
  const allMustFindMatched = mustFindMatched === mustFind.length;
  const anyMustNotFlagMatched = expectations.some(
    (e, i) => e.kind === 'must_not_flag' && matches[i]!.finding_id !== null,
  );
  const pass = allMustFindMatched && !anyMustNotFlagMatched;

  return {
    recall,
    precision,
    citation_accuracy: citationAccuracy,
    pass,
    matches,
    tp,
    fp,
    precision_undefined: precisionUndefined,
  };
}
