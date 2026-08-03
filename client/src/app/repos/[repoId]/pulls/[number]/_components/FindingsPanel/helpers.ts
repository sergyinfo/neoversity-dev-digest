import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

// countBySeverity now lives in lib/findings so the PR list and the run timeline
// can share it. Re-exported here because this panel's callers and tests have
// always imported it from this module.
export { countBySeverity } from "@/lib/findings";

/**
 * Findings left after the confidence filter. Both the severity counters and the
 * rendered list derive from THIS set, so the chip numbers always add up to the
 * cards on screen — including while "hide low confidence" is on.
 */
export function confidenceFiltered(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  return hideLow ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD) : findings;
}

/**
 * Confidence filter → optional narrowing to a single severity → severity sort.
 * `severity` is null when no chip is selected (show every level).
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | null = null,
): FindingRecord[] {
  let shown = confidenceFiltered(findings, hideLow);
  if (severity) shown = shown.filter((f) => f.severity === severity);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
