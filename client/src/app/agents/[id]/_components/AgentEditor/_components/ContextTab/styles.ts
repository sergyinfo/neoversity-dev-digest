import type { CSSProperties } from "react";

/** Co-located styles for the agent's read-only Context tab. */
export const s = {
  wrap: { padding: "20px 24px", maxWidth: 780 } satisfies CSSProperties,
  intro: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 18,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 16,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
