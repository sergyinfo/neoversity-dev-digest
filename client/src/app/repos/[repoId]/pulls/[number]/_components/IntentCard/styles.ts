import type { CSSProperties } from "react";

/**
 * Colours come exclusively from CSS custom properties, so both themes work
 * without a second definition (house convention — see other _components).
 */
export const s = {
  quote: {
    fontSize: 14,
    lineHeight: 1.5,
    fontStyle: "italic",
    color: "var(--text-primary)",
    margin: "0 0 14px",
    textWrap: "pretty",
  } satisfies CSSProperties,

  // Two columns on desktop, stacking on narrow viewports rather than squashing
  // two scope lists into unreadable slivers.
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 18,
  } satisfies CSSProperties,

  scopeHead: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color,
    marginBottom: 7,
  }),

  scopeList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 5,
  } satisfies CSSProperties,

  scopeItem: (color: string): CSSProperties => ({
    fontSize: 12.5,
    color,
    display: "flex",
    gap: 7,
    lineHeight: 1.45,
  }),

  bullet: (color: string): CSSProperties => ({ color, marginTop: 1 }),

  empty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  sourcesLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  spacer: { marginLeft: "auto" } satisfies CSSProperties,

  age: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
};
