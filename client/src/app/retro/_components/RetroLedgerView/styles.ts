import type { CSSProperties } from "react";

/** Co-located styles for the retro ledger page. CSS custom properties only,
 * per house convention — no Tailwind. */
export const s = {
  page: {
    padding: "24px 28px 40px",
    maxWidth: 900,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,

  titleRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  h1: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  stamp: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  subtitle: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    margin: 0,
    maxWidth: 720,
  } satisfies CSSProperties,

  filePath: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    padding: "18px 22px",
    fontSize: 13.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  scopeNote: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  scopeTitle: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  scopeBody: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
