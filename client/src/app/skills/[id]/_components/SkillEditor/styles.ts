import type { CSSProperties } from "react";

/** Co-located styles for the Skill editor. */
export const s = {
  page: { padding: "28px 32px", maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18 } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,

  tabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 18 } satisfies CSSProperties,
  tab: {
    padding: "8px 14px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--text-secondary)",
    fontSize: 13.5,
    cursor: "pointer",
  } satisfies CSSProperties,
  tabActive: { color: "var(--accent)", borderBottomColor: "var(--accent)" } satisfies CSSProperties,

  label: {
    display: "block",
    fontSize: 12.5,
    fontWeight: 500,
    color: "var(--text-secondary)",
    margin: "14px 0 6px",
  } satisfies CSSProperties,
  input: {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13.5,
  } satisfies CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 380,
    padding: "11px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 12.5,
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: 1.55,
    resize: "vertical",
  } satisfies CSSProperties,
  evidence: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: 1.7,
  } satisfies CSSProperties,
  preview: {
    padding: "18px 20px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
