import type { FindingRecord } from "@devdigest/shared";

/** `12` for a single line, `12-18` for a span — matches the finding cards. */
export function lineRange(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/**
 * Drop the markdown emphasis a model tends to put in a rationale.
 *
 * The hover card renders plain text, so `**bold**` and backticks would show up
 * as literal characters. Only the two markers that actually appear are stripped
 * — a full markdown parse in a tooltip is not worth the bytes.
 */
export function stripMd(text: string | null | undefined): string {
  return (text ?? "").replace(/\*\*|`/g, "");
}
