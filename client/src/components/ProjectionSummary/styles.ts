import type { CSSProperties } from "react";

/**
 * Colours come exclusively from CSS custom properties (house convention), so
 * both themes work without a second definition.
 */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,

  state: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  stateTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  stateBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,

  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  totalRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  } satisfies CSSProperties,

  total: {
    fontSize: 20,
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

  entries: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,

  entryRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    padding: "7px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  path: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  entryTokens: {
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,

  disabledSkills: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingTop: 8,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  disabledSkillsLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  disabledSkillsList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  disabledSkillItem: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};
