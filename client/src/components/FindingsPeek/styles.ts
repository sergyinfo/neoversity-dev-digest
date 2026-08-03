import type { CSSProperties } from "react";

/** Co-located styles for FindingsPeek (ported from screen_dashboard.jsx /
 *  prdetail_runs.jsx — the counts row and its hover card). */
export const s = {
  host: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    width: "fit-content",
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    // "help" rather than "pointer": the row underneath is the click target, this
    // only reveals detail.
    cursor: "help",
  } satisfies CSSProperties,

  count: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11.5,
    fontWeight: 600,
    color,
    borderBottom: `1px dotted ${color}`,
    paddingBottom: 1,
  }),

  empty: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  blockers: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  /**
   * `position: fixed`, not `absolute`, and this is not cosmetic.
   *
   * The PR table is a rounded card with `overflow: hidden`, which clips any
   * absolutely-positioned descendant — the card opened and was sliced off at the
   * row boundary. A fixed element resolves against the viewport instead, so an
   * ancestor's overflow cannot clip it, and unlike a portal it stays a DOM child
   * of the trigger, so moving the pointer into the card doesn't count as leaving
   * the trigger. (This only holds while no ancestor has transform / filter /
   * will-change, which would make it a containing block again.)
   *
   * The price is that coordinates must be measured; `anchor` is the trigger's
   * bounding rect.
   */
  card: (placement: "up" | "down", width: number, anchor?: DOMRect): CSSProperties => ({
    position: anchor ? "fixed" : "absolute",
    ...(anchor
      ? {
          // Keep the card on screen when the trigger sits near the right edge.
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 16)),
          ...(placement === "up"
            ? { bottom: window.innerHeight - anchor.top + 8 }
            : { top: anchor.bottom + 8 }),
        }
      : {
          left: 0,
          ...(placement === "up"
            ? { bottom: "100%", marginBottom: 8 }
            : { top: "100%", marginTop: 8 }),
        }),
    zIndex: 30,
    width,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    boxShadow: "var(--shadow-modal)",
    padding: 12,
    cursor: "default",
    textAlign: "left",
  }),

  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 9,
  } satisfies CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 9,
    maxHeight: 300,
    overflow: "auto",
  } satisfies CSSProperties,

  item: (last: boolean): CSSProperties => ({
    paddingBottom: last ? 0 : 9,
    borderBottom: last ? "none" : "1px solid var(--border)",
  }),

  itemHead: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  itemTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  itemMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "5px 0 0",
    minWidth: 0,
  } satisfies CSSProperties,

  // A long path (client/src/vendor/shared/contracts/findings.ts:55) otherwise
  // pushes the confidence clean off the edge of the card. Let the path shrink
  // and ellipsize; the full location is on the PR page, and the confidence is
  // the part that has nowhere else to appear.
  itemLoc: {
    fontSize: 11,
    color: "var(--accent-text)",
    flex: "0 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  confidence: { flexShrink: 0 } satisfies CSSProperties,

  // Two lines then ellipsis — the popup is a peek, the detail page is the read.
  itemBody: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
    marginTop: 5,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,

  more: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 8,
  } satisfies CSSProperties,
};
