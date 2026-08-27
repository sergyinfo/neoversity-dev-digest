import type { CSSProperties } from "react";

/**
 * Colours come exclusively from CSS custom properties, so both themes work
 * without a second definition (house convention — see the sibling IntentCard
 * and BlastCard).
 */
export const s = {
  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  riskLevelWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  riskLevelLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  block: { marginBottom: 16 } satisfies CSSProperties,

  blockHead: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,

  prose: {
    fontSize: 13.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    margin: 0,
    textWrap: "pretty",
  } satisfies CSSProperties,

  riskList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  riskItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingLeft: 10,
    borderLeft: "2px solid var(--border)",
  } satisfies CSSProperties,

  riskHead: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,

  riskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  riskKind: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  riskBody: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,

  refRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,

  focusList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 7,
  } satisfies CSSProperties,

  // A flex row that WRAPS: on a narrow viewport the reason drops below the
  // reference instead of squeezing the path into two unreadable characters.
  focusItem: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,

  focusReason: {
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    minWidth: 180,
    flex: "1 1 auto",
  } satisfies CSSProperties,

  caveat: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  empty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  meta: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  spacer: { marginLeft: "auto" } satisfies CSSProperties,

  outOfDate: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexBasis: "100%",
    fontSize: 12,
    color: "var(--warn)",
  } satisfies CSSProperties,

  /**
   * Visually hidden but still in the accessibility tree. The visible file
   * reference is middle-truncated and `aria-hidden`; this carries the full
   * `path:line` so the button ANNOUNCES the real target rather than an
   * ellipsis.
   */
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
} as const;
