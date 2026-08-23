import type { CSSProperties } from "react";

/**
 * Colours come exclusively from CSS custom properties, so both themes work
 * without a second definition (house convention — see the sibling IntentCard).
 */
export const s = {
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  stats: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,

  statNum: {
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  viewToggle: {
    display: "inline-flex",
    borderRadius: 6,
    overflow: "hidden",
    border: "1px solid var(--border-subtle)",
  } satisfies CSSProperties,

  viewBtn: (active: boolean): CSSProperties => ({
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--bg-raised)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),

  symbolRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    padding: "8px 0",
    background: "none",
    border: "none",
    borderTop: "1px solid var(--border-subtle)",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,

  symbolName: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  callerCount: {
    fontSize: 11,
    color: "var(--text-tertiary, var(--text-secondary))",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "2px 0 10px 18px",
  } satisfies CSSProperties,

  callerLine: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: 12,
  } satisfies CSSProperties,

  callerEnclosing: {
    color: "var(--text-tertiary, var(--text-secondary))",
    fontSize: 11,
  } satisfies CSSProperties,

  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "4px 0 10px 18px",
  } satisfies CSSProperties,

  banner: (tone: "warn" | "bad"): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.45,
    margin: "0 0 10px",
    color: "var(--text-primary)",
    background: tone === "bad" ? "var(--sev-critical-bg, rgba(220,80,80,.10))" : "var(--sev-warning-bg, rgba(220,170,60,.10))",
    border: `1px solid ${tone === "bad" ? "var(--sev-critical-border, rgba(220,80,80,.35))" : "var(--sev-warning-border, rgba(220,170,60,.35))"}`,
  }),

  priorHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "8px 0 0",
    marginTop: 6,
    borderTop: "1px solid var(--border-subtle)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    color: "var(--text-secondary)",
    textAlign: "left",
  } satisfies CSSProperties,

  priorList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 0 0 18px",
  } satisfies CSSProperties,

  priorFiles: {
    fontSize: 11,
    color: "var(--text-tertiary, var(--text-secondary))",
  } satisfies CSSProperties,

  graphWrap: {
    overflowX: "auto",
    padding: "8px 0",
  } satisfies CSSProperties,

  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingTop: 6,
  } satisfies CSSProperties,

  summaryBox: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    padding: "8px 0 0",
    borderTop: "1px solid var(--border-subtle)",
    marginTop: 6,
  } satisfies CSSProperties,
} as const;
