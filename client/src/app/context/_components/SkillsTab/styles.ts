import type { CSSProperties } from "react";

/** Co-located styles for the Skills tab. Same two-pane shape as `AgentsTab`,
 * kept as a sibling copy rather than shared — the two panes show a
 * projection and a contribution figure, which are not the same shape (D-10). */
export const s = {
  wrap: {
    display: "flex",
    gap: 24,
    alignItems: "flex-start",
  } satisfies CSSProperties,

  selector: {
    width: 220,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  selectorItem: (active: boolean) =>
    ({
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 10px",
      borderRadius: 7,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: active ? 600 : 500,
      color: active ? "var(--text-primary)" : "var(--text-secondary)",
      background: active ? "var(--bg-hover)" : "transparent",
      border: "1px solid " + (active ? "var(--border-strong)" : "transparent"),
    }) satisfies CSSProperties,

  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 18,
  } satisfies CSSProperties,

  docsCard: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "6px 14px",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  contribution: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "12px 16px",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  contributionValue: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  estimateMarker: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
