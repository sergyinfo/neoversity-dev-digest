import type { CSSProperties } from "react";
import type { SkillSource } from "@devdigest/shared";

/** Provenance shown on the card — where the skill came from. */
export const SOURCE_LABEL: Record<SkillSource, string> = {
  manual: "written by hand",
  extracted: "from conventions",
  imported_url: "imported",
  community: "community",
};

export const s = {
  page: { padding: "28px 32px", maxWidth: 1100 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,

  importRow: { display: "flex", gap: 8, marginBottom: 16 } satisfies CSSProperties,
  importInput: {
    flex: 1,
    padding: "9px 11px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  error: {
    marginBottom: 14,
    padding: "9px 12px",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
  } satisfies CSSProperties,

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,
  card: {
    textAlign: "left",
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  cardHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } satisfies CSSProperties,
  cardName: {
    fontSize: 14.5,
    fontWeight: 600,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  cardDesc: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 10,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  cardMeta: {
    display: "flex",
    gap: 6,
    fontSize: 11.5,
    color: "var(--text-muted)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
} as const;
