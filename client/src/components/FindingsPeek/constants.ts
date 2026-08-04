/** Findings shown inside the hover card before it collapses into "+N more".
 *  The card scrolls at 300px; past roughly this many the scroll is the only way
 *  through, and at that point the PR page is the better place to read them. */
export const MAX_PREVIEW_ITEMS = 8;

/** Default hover-card width, in px. The PR list is tighter than the timeline. */
export const DEFAULT_WIDTH = 380;

/**
 * The design draws the counts slightly tighter in the PR list than in the run
 * timeline — `FindingsCell` uses gap 3 / icon 12, `RunFindings` uses gap 4 /
 * icon 12.5. A list row is denser than a timeline card, so the difference is
 * deliberate; these keep both honest instead of averaging them into one look.
 */
export const COUNT_METRICS = {
  list: { gap: 3, icon: 12, rowGap: 8 },
  timeline: { gap: 4, icon: 12.5, rowGap: 10 },
} as const;

export type PeekVariant = keyof typeof COUNT_METRICS;
