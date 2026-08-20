import type { SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS } from './constants.js';

/**
 * Path-only, deterministic file classification. No model call, no file contents,
 * no repo index — so it answers the moment a PR is imported and gives the same
 * answer every time, which is what lets the UI sort before any review exists.
 */

/** Normalise a path for matching: forward slashes, no leading `./` or `/`. */
function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/**
 * Classify one path.
 *
 * Order is load-bearing: boilerplate wins over wiring, and `core` is the
 * fallback rather than a pattern list of its own. Business logic has no
 * recognisable shape — the only honest rule is "everything nobody claimed".
 * Erring toward `core` also errs toward showing a reviewer more, which is the
 * cheaper mistake.
 */
export function classifyPath(path: string): SmartDiffRole {
  const p = normalise(path);
  if (BOILERPLATE_PATTERNS.some((re) => re.test(p))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(p))) return 'wiring';
  return 'core';
}

/**
 * Risk order WITHIN a group, most-worth-reading first:
 *   1. files carrying findings, by how many;
 *   2. then by size of the change;
 *   3. then by path, so the result is stable across identical inputs.
 *
 * Step 3 matters more than it looks: without it two files with equal findings
 * and equal size could swap places between requests, and a reviewer who scrolled
 * away and came back would find the list reordered.
 */
export function compareByRisk(
  a: { path: string; additions: number; deletions: number; finding_lines: number[] },
  b: { path: string; additions: number; deletions: number; finding_lines: number[] },
): number {
  if (a.finding_lines.length !== b.finding_lines.length) {
    return b.finding_lines.length - a.finding_lines.length;
  }
  const aSize = a.additions + a.deletions;
  const bSize = b.additions + b.deletions;
  if (aSize !== bSize) return bSize - aSize;
  return a.path.localeCompare(b.path);
}
