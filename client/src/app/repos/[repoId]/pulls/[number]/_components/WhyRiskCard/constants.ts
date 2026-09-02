import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";
import type { MovedInput } from "@/lib/hooks/brief";

/**
 * Risk level is shown as a WORD plus an icon, never colour alone (WCAG AA),
 * exactly as the sibling `IntentCard/constants.ts` does for its confidence
 * band.
 *
 * It deliberately does NOT go through `SeverityBadge`: that primitive is keyed
 * by the finding severity enum (`CRITICAL | WARNING | SUGGESTION | INFO`), and
 * `RiskSeverity` is a different, three-value enum (`high | medium | low`).
 * Passing one to the other does not typecheck, and mapping between them would
 * invent an equivalence the two contracts do not have.
 */
export const RISK_META: Record<
  RiskSeverity,
  { color: string; bg: string; icon: IconName; labelKey: string }
> = {
  high: {
    color: "var(--crit)",
    bg: "var(--crit-bg, var(--bg-hover))",
    icon: "AlertOctagon",
    labelKey: "high",
  },
  medium: {
    color: "var(--warn)",
    bg: "var(--warn-bg, var(--bg-hover))",
    icon: "AlertTriangle",
    labelKey: "medium",
  },
  low: {
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    icon: "Info",
    labelKey: "low",
  },
};

/**
 * How each fingerprint component is named in the out-of-date marker.
 *
 * These are plain strings rather than i18n keys because `messages/en/brief.json`
 * ships `outOfDate.moved` as a single sentence taking an already-rendered
 * `{inputs}` list, and adding eight sibling keys is a change to a committed
 * message file outside this change's scope. Hard-coded English labels are the
 * house pattern in these cards already (see `BlastCard`'s degraded banner).
 */
export const MOVED_INPUT_LABEL: Record<MovedInput, string> = {
  head_sha: "the PR head commit",
  intent_derived_at: "the derived intent",
  intent_model: "the intent model",
  indexed_sha: "the code index",
  blast_state: "the blast radius",
  model_provider: "the model provider",
  model_id: "the model",
  assembler_version: "the brief assembler",
};

/** Risks shown before the list is cut. The card summarises; it is not a report. */
export const MAX_RISKS = 6;

/** Review-focus entries shown. Beyond ~8 "read this first" stops meaning it. */
export const MAX_FOCUS = 8;

/** Characters a file reference may occupy before it is middle-truncated. */
export const PATH_MAX_CHARS = 44;

/**
 * Middle-truncate a path so the FILENAME — the part a reviewer scans for —
 * survives. Head truncation would hide it; CSS ellipsis can only clip one end.
 * The full value stays available through the `title` on the rendered element.
 */
export function middleTruncate(text: string, max: number = PATH_MAX_CHARS): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * Split a `file_refs` entry into a path and an optional line.
 *
 * The contract types it as a bare string (`contracts/brief.ts`) and both forms
 * reach us: the model writes `path` from the changed-file list and `path:line`
 * by copying the dependency map, which renders a caller as
 * `called from src/server.ts:12 (bootstrap)`. Server-side grounding splits the
 * same suffix before matching the path against its allow-list
 * (`brief/grounding.ts` `groundedRef`), so a surviving entry's PATH is always
 * observed — the line is the model's, carried through unchecked, because a
 * caller's line is valid at the index's tree rather than at the PR head.
 *
 * A trailing `:<digits>` is the only form treated as a line; anything else stays
 * part of the path, so a filename containing a colon is opened rather than
 * mangled.
 */
export function splitFileRef(ref: string): { file: string; line?: number } {
  const m = /^(.*):(\d+)$/.exec(ref);
  if (!m) return { file: ref };
  return { file: m[1]!, line: Number(m[2]) };
}

/**
 * The brief's `generated_at` as an absolute local timestamp — never a relative
 * phrase.
 *
 * Spec §10 requires this and D-1a is why: an edited linked issue or reference
 * document moves only the REMOTE half of the state fingerprint, which the read
 * path never recomputes, so the card shows such a brief as current. What dates
 * it is this timestamp and the provenance list, and "just now" would actively
 * assert the freshness D-1a knowingly cannot check. An absent or unparseable
 * value renders "—" rather than "Invalid Date": missing is missing.
 *
 * `toLocaleString` matches the shipped `CommentCard.formatWhen`; the component
 * is a client component, so there is no server render to disagree with.
 */
export function formatGeneratedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
