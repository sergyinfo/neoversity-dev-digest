import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_LEVELS, SEVERITY_ORDER } from "./constants";

/**
 * Findings left after the confidence filter. Both the severity counters and the
 * rendered list derive from THIS set, so the chip numbers always add up to the
 * cards on screen — including while "hide low confidence" is on.
 */
export function confidenceFiltered(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  return hideLow ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD) : findings;
}

/**
 * Count findings per severity over an already confidence-filtered set. Every
 * level in `SEVERITY_LEVELS` is present in the result (0 when absent) so the
 * chip row keeps a stable width instead of popping in and out.
 */
export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_LEVELS.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as Severity] += 1;
  }
  return counts;
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
