/**
 * Response shaping.
 *
 * The two token costs of an MCP server are schema bloat (definitions loaded at
 * session start) and response bloat (tool output flowing back into context).
 * This file owns the second one. Claude Code warns above 10k tokens of tool
 * output and truncates at 25k by default (`MAX_MCP_OUTPUT_TOKENS`), so every
 * tool here caps its own output well below that and tells the model how to
 * narrow the query instead of silently cutting data off.
 */
import { ApiError } from './api.js';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });

/**
 * A failed tool call is a normal result with `isError: true`, not a thrown
 * exception — the model reads the text and retries. Never return an empty
 * successful result for a failure: "no data" and "the call failed" must not
 * look the same to the agent.
 */
export const fail = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/** Wrap a handler so any error becomes an actionable `isError` result. */
export function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch((err: unknown) => {
    if (err instanceof ApiError) return fail(err.message);
    return fail(`devdigest-mcp failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** Collapse markdown/whitespace to one line and cap it. */
export function oneLine(s: string | null | undefined, max = 160): string {
  if (!s) return '';
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Cap a block of text, appending a note the model can act on. */
export function capped(text: string, maxChars: number, hint: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters — ${hint}]`;
}

/**
 * Fence a block of THIRD-PARTY prose with its provenance.
 *
 * Finding explanations, convention rules and PR titles are all written by
 * someone else — a model reading another repository's diff, or that
 * repository's authors. They reach the calling agent as tool output, which is
 * a documented prompt-injection surface: the MCP specification is explicit that
 * tool results are data, never instructions.
 *
 * This mirrors `<untrusted source="pr-intent">` in `reviewer-core/prompt.ts`, so
 * both halves of the system name the same hazard the same way. It is a marker,
 * not a sanitiser: the defence is that the reader knows the provenance, exactly
 * as the server's INJECTION_GUARD does — a denylist would only ever catch one
 * phrasing.
 *
 * Applied once per block, not per line: the point is provenance, and repeating
 * the tag would cost tokens on every result for no extra signal.
 */
export function untrusted(source: string, text: string): string {
  return `<untrusted source="${source}">\n${text}\n</untrusted>`;
}
