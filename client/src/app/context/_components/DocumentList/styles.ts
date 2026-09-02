import type { CSSProperties } from "react";

/** Co-located styles for the discovered-document list. CSS custom properties
 * only, per house convention — no Tailwind. */
export const s = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "9px 4px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,

  path: {
    flex: 1,
    minWidth: 0,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  meta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,

  tokens: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  estimateMarker: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Visually hidden but still in the accessibility tree — carries the full,
   * untruncated path. See `WhyRiskCard`'s `FileRef` for the same pattern. */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,

  cappedNotice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    marginBottom: 10,
    borderRadius: 7,
    background: "var(--warn-bg, var(--bg-hover))",
    color: "var(--warn)",
    fontSize: 12.5,
  } satisfies CSSProperties,
} as const;
