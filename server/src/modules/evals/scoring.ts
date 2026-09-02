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
 * Greedy expectation → finding assignment, in file order.
 *
 * Returns one `EvalMatch` per expectation, in the expectations' ORIGINAL order,
 * because `EvalMatch.expectation_index` indexes back into the stored
 * `ExpectedOutput.expectations` array (contract.ts) and the envelope would be
 * unreadable if the indices were the sorted ones.
 *
 * The WALK, however, is in file order — `(file, start_line, end_line, original
 * index)` — so the result depends only on the CONTENT of the inputs and not on
 * the order they happen to arrive in. Two expectations on the same lines are
 * therefore resolved by their original index, deterministically, and the second
 * gets `finding_id: null` rather than a second bite at the same finding
 * (Edge-6).
 *
 * A finding, once claimed, is not offered to any later expectation.
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
        a.expectation.file.localeCompare(b.expectation.file) ||
        a.expectation.start_line - b.expectation.start_line ||
        a.expectation.end_line - b.expectation.end_line ||
        a.index - b.index,
    );

  const claimed = new Set<number>();
  for (const { expectation, index } of order) {
    for (let f = 0; f < findings.length; f += 1) {
      if (claimed.has(f)) continue;
      const finding = findings[f]!;
      if (!sameLocation(expectation, finding)) continue;
      claimed.add(f);
      matches[index]!.finding_id = finding.id;
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
