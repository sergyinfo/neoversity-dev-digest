import type { CSSProperties } from "react";

/** Co-located styles for the agent's Evals tab (L06). */
export const s = {
  wrap: { padding: "20px 24px", maxWidth: 820 } satisfies CSSProperties,
  subtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: -8,
    marginBottom: 16,
  } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12, marginBottom: 22 } satisfies CSSProperties,
  casesHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowName: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  rowResult: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 } satisfies CSSProperties,
  hint: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginBottom: 16,
  } satisfies CSSProperties,
  error: {
    marginTop: 14,
    padding: "9px 12px",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
