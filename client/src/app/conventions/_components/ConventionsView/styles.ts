import type { CSSProperties } from "react";

/** Co-located styles for the Conventions view. */
export const s = {
  page: { padding: "28px 32px", maxWidth: 1100 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  repoName: { color: "var(--accent)", fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  counts: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  toolbarRight: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,

  card: {
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  cardBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: {
    fontSize: 15,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
    marginBottom: 10,
  } satisfies CSSProperties,
  ruleInput: {
    width: "100%",
    fontSize: 15,
    fontWeight: 600,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--accent)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    marginBottom: 10,
  } satisfies CSSProperties,

  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: "7px 7px 0 0",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderBottom: "none",
    fontSize: 12.5,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  evidenceLink: { color: "var(--text-secondary)", textDecoration: "none" } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: "0 0 7px 7px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 12.5,
    fontFamily: "var(--font-mono, monospace)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,

  meta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bar: {
    width: 130,
    height: 5,
    borderRadius: 3,
    background: "var(--bg-hover)",
    overflow: "hidden",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 150,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;

/** Left accent per status, so a scan of the list reads at a glance. */
export function cardAccent(status: string): CSSProperties {
  const color =
    status === "accepted" ? "var(--ok)" : status === "rejected" ? "var(--text-muted)" : "var(--warn)";
  return { borderLeft: `3px solid ${color}`, opacity: status === "rejected" ? 0.55 : 1 };
}

/** Confidence bar colour — matches the severity palette used elsewhere. */
export function confidenceColor(c: number): string {
  if (c >= 0.85) return "var(--ok)";
  if (c >= 0.75) return "var(--warn)";
  return "var(--crit)";
}
