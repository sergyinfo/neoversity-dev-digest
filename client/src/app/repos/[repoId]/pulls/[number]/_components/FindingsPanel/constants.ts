import type { FindingActionKind } from "@devdigest/shared";

// The filter chips read their levels from SEVERITY_LEVELS in `@/lib/findings`,
// which the PR list and run timeline share. Kept out of this file so there is
// one list, not three that drift.

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** Confidence below this is hidden when "hide low confidence" is on. */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** Keyboard shortcut → finding action. */
export const KEY_TO_ACTION: Record<string, FindingActionKind> = {
  a: "accept",
  d: "dismiss",
};
