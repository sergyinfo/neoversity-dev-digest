/** Characters a document path may occupy before it is middle-truncated. */
export const PATH_MAX_CHARS = 52;

/**
 * Middle-truncate a path so the FILENAME — the part a reviewer scans for —
 * survives. Head truncation would hide it; CSS ellipsis can only clip one
 * end. Copied from `WhyRiskCard/constants.ts`'s `middleTruncate` (same
 * problem, same fix) rather than reinvented; the full value is still carried
 * by the caller in an `srOnly` span plus a `title`.
 */
export function middleTruncate(text: string, max: number = PATH_MAX_CHARS): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
