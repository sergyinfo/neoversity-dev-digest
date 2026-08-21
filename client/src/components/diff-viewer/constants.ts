/** Constants for the DiffViewer. */

/** Files with this many or fewer changed lines start expanded. */
export const AUTO_EXPAND_MAX_LINES = 200;

/**
 * How long a jumped-to line stays highlighted after a badge click. Long enough
 * to find with the eye after the smooth scroll settles, short enough that the
 * page does not stay decorated.
 */
export const FINDING_FLASH_MS = 1600;

/** Matches a unified-diff hunk header, e.g. `@@ -1,2 +1,3 @@`. */
export const HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
