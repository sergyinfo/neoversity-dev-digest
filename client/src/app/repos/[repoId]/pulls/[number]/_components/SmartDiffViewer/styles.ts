import type { CSSProperties } from "react";

export const s = {
  group: { marginTop: 18 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 2px 8px",
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  label: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  count: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  empty: {
    padding: "10px 2px",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  files: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  splitNote: {
    marginTop: 14,
    padding: "10px 12px",
    borderRadius: 7,
    fontSize: 12,
    border: "1px solid color-mix(in srgb, var(--sev-warning, #d29922) 30%, transparent)",
    background: "color-mix(in srgb, var(--sev-warning, #d29922) 8%, transparent)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
