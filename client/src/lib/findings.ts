import type { FindingRecord, Severity } from "@devdigest/shared";

/**
 * Findings vocabulary shared across routes.
 *
 * These started life inside the PR-detail FindingsPanel. They moved here once the
 * PR list and the run timeline needed the same tally: shared code must not reach
 * into a route's `_components/`, so a second consumer is the signal to promote.
 */

/** Severity levels in display order — worst first. */
export const SEVERITY_LEVELS: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/**
 * Tally findings by severity.
 *
 * Every level is present in the result, zeros included. Counters that appear and
 * disappear with the data make a row jump around; a stable set of keys also lets
 * a caller distinguish "none of this severity" from "not counted" without a
 * second flag.
 */
export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_LEVELS.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as Severity] += 1;
  }
  return counts;
}

/**
 * Group findings by the run that produced them.
 *
 * The timeline lists runs, but findings hang off reviews — one review per run.
 * Reviews whose `run_id` is null (imported or legacy rows) are skipped rather
 * than bucketed under a placeholder key, so a timeline row only ever shows
 * findings that genuinely belong to it.
 */
export function groupFindingsByRun(
  reviews: readonly { run_id: string | null; findings: FindingRecord[] }[],
): Map<string, FindingRecord[]> {
  const byRun = new Map<string, FindingRecord[]>();
  for (const review of reviews) {
    if (!review.run_id) continue;
    const bucket = byRun.get(review.run_id);
    if (bucket) bucket.push(...review.findings);
    else byRun.set(review.run_id, [...review.findings]);
  }
  return byRun;
}
