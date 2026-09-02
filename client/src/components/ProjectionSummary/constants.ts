import type { IconName } from "@devdigest/ui";
import type { ProjectionOrigin, ProjectionOutcome } from "@/lib/hooks/project-context";

/**
 * Where a projected document came from, shown as a WORD + icon (WCAG AA —
 * never colour alone), the standing pattern from `IntentCard/constants.ts`'s
 * `CONFIDENCE_META` and `WhyRiskCard/constants.ts`'s `RISK_META`.
 */
export const ORIGIN_META: Record<
  ProjectionOrigin,
  { color: string; bg: string; icon: IconName; labelKey: string }
> = {
  agent: {
    color: "var(--text-secondary)",
    bg: "var(--bg-hover)",
    icon: "FileText",
    labelKey: "origin.agent",
  },
  skill: {
    color: "var(--accent)",
    bg: "var(--bg-hover)",
    icon: "Link",
    labelKey: "origin.skill",
  },
};

/** What a run would do with the document right now, same word+icon pattern. */
export const OUTCOME_META: Record<
  ProjectionOutcome,
  { color: string; bg: string; icon: IconName; labelKey: string }
> = {
  injected: {
    color: "var(--ok)",
    bg: "var(--ok-bg, var(--bg-hover))",
    icon: "CheckCircle",
    labelKey: "outcome.injected",
  },
  dropped_budget: {
    color: "var(--warn)",
    bg: "var(--warn-bg, var(--bg-hover))",
    icon: "AlertTriangle",
    labelKey: "outcome.dropped_budget",
  },
  skipped: {
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    icon: "XCircle",
    labelKey: "outcome.skipped",
  },
};
