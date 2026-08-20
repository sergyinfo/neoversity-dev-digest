import type { CSSProperties } from "react";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  /**
   * A line the latest review flagged. A left border rather than a background
   * tint: the add/del tint already owns the row background, and stacking a
   * second one makes an added-and-flagged line unreadable.
   */
  findingLine: {
    borderLeft: "2px solid var(--sev-warning, #d29922)",
    marginLeft: -2,
  } satisfies CSSProperties,
  /** The same line just after a badge jump — briefly lit so the eye lands on it. */
  findingLineFlash: {
    borderLeft: "2px solid var(--sev-warning, #d29922)",
    marginLeft: -2,
    background: "var(--code-highlight, rgba(210,153,34,.14))",
    transition: "background .3s",
  } satisfies CSSProperties,
  /** Clickable "N findings" chip in a file header. */
  findingBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    padding: "2px 7px",
    borderRadius: 999,
    cursor: "pointer",
    color: "var(--sev-warning, #d29922)",
    background: "color-mix(in srgb, var(--sev-warning, #d29922) 14%, transparent)",
    border: "1px solid color-mix(in srgb, var(--sev-warning, #d29922) 35%, transparent)",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent). */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return { display: "flex", alignItems: "stretch", fontSize: 13, lineHeight: "20px", background };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
