/**
 * L05 — REQ-15's per-assembly provenance record.
 *
 * WHY THIS EXISTS: "why does the brief say that?" is usually answered by what
 * the input contained, but the input itself is the one thing we must not write
 * to disk — it carries the linked issue, whatever a private plan document says,
 * and a derived intent built from the PR author's prose. So we record the SHAPE
 * of the assembly (which of the five sources contributed, which documents were
 * read, which were not and why, how big, which model, what it cost) and never
 * the text.
 *
 * SAFETY CONTRACT — this module must never emit input content. It is the same
 * contract `modules/reviews/prompt-log.ts:6-21` holds for the review prompt, and
 * it is stated again here rather than referenced because a contract you have to
 * follow a link to read is one that gets broken:
 *
 *   - values are numbers, fixed source labels, repository paths, `#N`
 *     references, URLs and model identifiers;
 *   - a source IDENTIFIER is permitted and content is not — `docs/plans/x.md`
 *     names where a document came from, and that is the whole point of the
 *     record; the document's text never appears, in any field, at any length;
 *   - identifiers and reasons are clamped to a bounded length, so a source
 *     string long enough to BE a payload is truncated rather than trusted. This
 *     is the mechanical half of the guarantee: the prose above is an intention,
 *     the clamp is a limit;
 *   - there is no verbosity level that turns content on. There is no `verbose`
 *     parameter at all, and adding one would be a change to this contract.
 *
 * `server/test/brief-provenance.test.ts` asserts all of this against planted
 * secrets — one in the PR body, one in the linked issue, one in a referenced
 * document — rather than trusting this comment.
 *
 * TYPE-LEVEL HALF OF THE GUARANTEE: this function cannot be handed a
 * `ResolvedReference`. It takes `references_used: readonly string[]` — source
 * identifiers, already extracted by the assembler — so there is no code path
 * here that can reach a document's `.content` even by accident.
 */
import {
  BriefProvenance,
  type BriefBlastState,
  type BriefInput,
  type SkippedSource,
} from './contract.js';
import type { AssembledBriefInput } from './assemble.js';

/**
 * Identifiers are paths, `#N` references and URLs; none of those is long. A
 * source that arrives longer than this is not an identifier, and is clamped
 * rather than recorded — the same instinct behind `prompt-log.test.ts`'s
 * "nothing long enough to be a payload slipped through".
 */
const MAX_SOURCE_CHARS = 200;
/** Reasons are ours ("budget", "external fetching disabled") or a short error. */
const MAX_REASON_CHARS = 160;

/** Canonical order, so two records for the same assembly read identically. */
const INPUT_ORDER: readonly BriefInput[] = [
  'intent',
  'blast',
  'diff',
  'linked_issue',
  'references',
];

export interface ProvenanceInput {
  /**
   * The assembly, for its four content-free fields. The `system` and `user`
   * messages on it are never read — see the field list in `buildProvenance`.
   */
  assembly: AssembledBriefInput;
  /** Sources the resolver could not read, with why. Never their content. */
  references_skipped: readonly SkippedSource[];
  /** How many model references REQ-6 grounding discarded. */
  discarded_refs: number;
  /**
   * The blast map's state at assembly time.
   *
   * Required HERE and optional in the schema, deliberately: every record this
   * function writes carries it, so no caller can quietly omit it, while a row
   * written before the field still parses on the way back out. It is not a
   * second copy of the live blast state — it is what the model was given, which
   * is the only version a stored brief can be judged against.
   */
  blast_state: BriefBlastState;
  /** The provider's own numbers. Null when there was no call, or none reported. */
  result?: {
    model?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    /** Read from `ReviewOutcome`-shaped results, never recomputed. */
    costUsd?: number | null;
  } | null;
}

function clamp(value: string, max: number): string {
  const s = value.trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function clampSources(items: readonly SkippedSource[]): SkippedSource[] {
  return items.map((item) => ({
    source: clamp(item.source, MAX_SOURCE_CHARS),
    reason: clamp(item.reason, MAX_REASON_CHARS),
  }));
}

/** A count, or null when the provider reported none. Never invented. */
function count(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * Describe an assembly without reproducing any of it.
 *
 * The output is `BriefProvenance.parse`d before it is returned, so a record
 * that does not satisfy the contract fails here — at the point a developer can
 * see it — rather than at the point it is written to `pr_brief.provenance` or
 * served in the envelope.
 */
export function buildProvenance(input: ProvenanceInput): BriefProvenance {
  const { assembly } = input;

  // Deduped and put in canonical order rather than trusted as given: the
  // assembler builds this list positionally, and two records describing the
  // same assembly should be comparable byte for byte.
  const used = new Set(assembly.inputs_used);
  const inputs_used = INPUT_ORDER.filter((id) => used.has(id));

  const references_used = [...new Set(assembly.references_used)].map((s) =>
    clamp(s, MAX_SOURCE_CHARS),
  );

  return BriefProvenance.parse({
    inputs_used,
    references_used,
    references_skipped: clampSources(input.references_skipped),
    dropped_items: clampSources(assembly.dropped_items),
    estimated_input_tokens: Math.max(0, Math.round(assembly.estimated_input_tokens)),
    tokens_in: count(input.result?.tokensIn),
    tokens_out: count(input.result?.tokensOut),
    // Cost may legitimately be 0 and may legitimately be null; only a
    // non-number becomes null, so "free" and "unknown" stay distinguishable.
    cost_usd:
      typeof input.result?.costUsd === 'number' && Number.isFinite(input.result.costUsd)
        ? input.result.costUsd
        : null,
    discarded_refs: Math.max(0, Math.round(input.discarded_refs)),
    model: input.result?.model ? clamp(input.result.model, MAX_SOURCE_CHARS) : null,
    // How COMPLETE the two inputs the brief can be silently wrong about were.
    // `inputs_used` says a source contributed; only these say how much of it
    // did, which is what spec §6's two caveats are rendered from. Both are
    // numbers and a fixed label, so the safety contract above is untouched.
    blast_state: input.blast_state,
    changed_files: { listed: assembly.files_listed, total: assembly.files_total },
    // REQ-4a. Read off the assembly, where it is REQUIRED, and written on every
    // record this function produces — so the field is optional on the way back
    // out (old rows still parse) and impossible to omit on the way in.
    drop_order_exhausted: assembly.drop_order_exhausted,
  });
}
