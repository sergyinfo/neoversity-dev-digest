import type { IconName } from "@devdigest/ui";
import type { IntentConfidence, IntentSource } from "@/lib/types";

/**
 * Confidence is shown as a WORD, not a percentage. The band comes from a
 * three-level enum on purpose (a cheap classifier's "87%" would be invented
 * precision), so rendering it through ConfidenceNum — which prints "87% conf" —
 * would reintroduce exactly the false precision the contract avoids.
 */
export const CONFIDENCE_META: Record<
  IntentConfidence,
  { color: string; bg: string; icon: IconName; labelKey: string }
> = {
  high: {
    color: "var(--ok)",
    bg: "var(--ok-bg, var(--bg-hover))",
    icon: "CheckCircle",
    labelKey: "high",
  },
  medium: {
    color: "var(--warn)",
    bg: "var(--warn-bg, var(--bg-hover))",
    icon: "AlertTriangle",
    labelKey: "medium",
  },
  low: {
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    icon: "Info",
    labelKey: "low",
  },
};

/** Icon per evidence source, strongest first — the order they render in. */
export const SOURCE_ORDER: IntentSource[] = [
  "spec",
  "linked_issue",
  "pr_description",
  "commits",
  "branch",
  "file_paths",
];

export const SOURCE_ICON: Record<IntentSource, IconName> = {
  spec: "FileText",
  linked_issue: "Link",
  pr_description: "MessageSquare",
  commits: "GitCommit",
  branch: "GitBranch",
  file_paths: "Code",
};
