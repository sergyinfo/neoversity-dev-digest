import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page. CSS custom properties
 * only, per house convention — no Tailwind. */
export const s = {
  page: {
    padding: "24px 28px 40px",
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 14,
    marginBottom: 4,
  } satisfies CSSProperties,

  h1: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  synced: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  cappedNotice: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 12px",
    borderRadius: 8,
    background: "var(--warn-bg, var(--bg-hover))",
    color: "var(--warn)",
    fontSize: 13,
  } satisfies CSSProperties,

  section: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    padding: "12px 18px",
  } satisfies CSSProperties,

  sectionLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,

  tabsBar: {
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  tabBody: {
    paddingTop: 18,
  } satisfies CSSProperties,
} as const;
