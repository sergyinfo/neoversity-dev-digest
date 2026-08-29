/**
 * The ledger's own file format, as the `/retro` command writes it.
 *
 * The file opens with a header and a scope note, then this marker, then the
 * entries — newest first. So "has this ledger got any entries?" is answered by
 * what follows the marker, not by whether the file has content: today the file
 * is a header, a scope note and the marker, and rendering that as though it
 * were a full ledger would be misleading.
 */
export const ENTRIES_MARKER = "<!-- entries below, newest first -->";

/**
 * The text after the entries marker, or `null` when the file carries no marker
 * at all. `null` is deliberately distinct from `""`: it means "this file does
 * not follow the format", which is not the same as "this file has no entries".
 */
export function entriesAfterMarker(content: string): string | null {
  const at = content.indexOf(ENTRIES_MARKER);
  if (at === -1) return null;
  return content.slice(at + ENTRIES_MARKER.length).trim();
}

/**
 * Whether the ledger has any retrospectives in it.
 *
 * FAILS TOWARDS SHOWING CONTENT. If the marker is missing — someone reformatted
 * the file, or the format moved on — we cannot tell entries from preamble, so
 * any non-empty file counts as having entries. Getting that wrong renders a
 * "nothing here yet" panel over a ledger that has real entries in it, which is
 * the one failure mode worth engineering against.
 */
export function hasEntries(content: string): boolean {
  const rest = entriesAfterMarker(content);
  return rest === null ? content.trim().length > 0 : rest.length > 0;
}

/** `2026-08-29, 14:03` — a file mtime, so date and time both matter. */
export function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The ledger's markdown, ready to render.
 *
 * HTML comments are stripped, because the vendored `Markdown` primitive runs
 * `react-markdown` with `remark-gfm` and NO `rehype-raw`: raw HTML is escaped
 * rather than parsed, so `<!-- entries below, newest first -->` renders on the
 * page as that literal string. It is a structural marker for the `/retro`
 * command, not prose, and showing it to a reader is noise.
 *
 * This is the only transform applied — the file is otherwise rendered verbatim,
 * and a comment is by definition not reader-facing, so nothing meaningful is
 * hidden. Do not extend this into general content rewriting.
 */
export function forDisplay(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "").trimEnd();
}
