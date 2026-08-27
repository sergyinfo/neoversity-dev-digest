/**
 * L05 — REQ-8's state fingerprint, split into a locally recomputable half and a
 * remote half (D-1a).
 *
 * PURE BY DESIGN: no container, no I/O, no `platform/` import. `createHash` is
 * arithmetic, not I/O — the same call `reviews/prompt-log.ts` makes for the same
 * reason.
 *
 * WHY A FINGERPRINT AT ALL. "Cached for a specific PR state" has to name the
 * state, and the head sha alone provably does not: intent can be re-derived, the
 * index can be re-analysed, the linked issue can be edited, a referenced
 * document can be edited and the feature model can be changed — five ways for a
 * brief to become wrong with the head untouched (D-1). All ten components below
 * are stored and all ten are compared at the next assembly.
 *
 * WHY IT IS SPLIT. Only the `local` half is recomputable without going out to
 * the network: recomputing `remote` means a live GitHub call and a set of clone
 * reads on EVERY PR open — the work D-14 forbids and §7's 300 ms read budget
 * cannot hold. So the read path recomputes `local`, and an edited issue or an
 * edited document is caught at the next assembly instead. That trade is the
 * reason the card must render `generated_at` and offer regenerate on a brief
 * that reads as current (F-9).
 *
 * CONTENT NEVER ENTERS A COMPONENT. The remote half carries the issue's number
 * and state and a truncated digest of its text, and each document's source
 * identifier and a truncated digest of its text. A digest is a change detector,
 * not a payload — it tells you the input DIFFERS between two assemblies without
 * telling you what either said. `brief-fingerprint.test.ts` asserts this rather
 * than trusting this paragraph.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BriefFingerprint, MovedInput } from './contract.js';

/**
 * Length of a content digest, in hex characters. 12 = 48 bits, the same figure
 * and the same rationale as `reviews/prompt-log.ts:80` — enough to detect an
 * edit, far too little to be a payload.
 */
const DIGEST_CHARS = 12;

/** Stand-in for an input that is absent, so absence is a value and not a hole. */
const NONE = 'none';

/**
 * The eight locally recomputable components, by name.
 *
 * The keys are exactly `MovedInput`'s members — `brief-fingerprint.test.ts`
 * asserts that mechanically, so adding a component here without extending the
 * vocabulary (or the reverse) fails a test rather than silently producing a
 * marker nobody can name.
 *
 * Every value is an identifier, a timestamp or one of our own version strings.
 * None of them is input content.
 */
export const LocalComponents = z.object({
  /** The PR head sha the brief describes. */
  head_sha: z.string(),
  /** When the stored intent row was derived — moves when intent is re-derived. */
  intent_derived_at: z.string(),
  /** Which model derived it. A cheaper classifier is a different intent. */
  intent_model: z.string(),
  /** The sha the index was built from. Moves on `POST /repos/:id/resync`. */
  indexed_sha: z.string(),
  /** `ok` / `partial` / `degraded`, or absent. A partial map is a different map. */
  blast_state: z.string(),
  /** Resolved `risk_brief` provider and model. */
  model_provider: z.string(),
  model_id: z.string(),
  /** This module's own version — see `ASSEMBLER_VERSION`. */
  assembler_version: z.string(),
});
export type LocalComponents = z.infer<typeof LocalComponents>;

/** The two remote components: the linked issue, and the resolved documents. */
export const RemoteComponents = z.object({
  /** `#N|state|<digest>` for the linked issue, or `none`. */
  linked_issue: z.string(),
  /** `<source>|<digest>` per resolved document, sorted, joined. Or `none`. */
  documents: z.string(),
});
export type RemoteComponents = z.infer<typeof RemoteComponents>;

export interface FingerprintInput {
  /** The PR head sha. */
  headSha: string | null | undefined;
  /** The stored `pr_intent` row, read and never derived (D-12). */
  intent: { derived_at?: string | null; model?: string | null } | null | undefined;
  /** The blast envelope. `null` when the map could not be built at all. */
  blast: { indexed_sha?: string | null; state?: string | null } | null | undefined;
  /** The resolved `risk_brief` choice. */
  model: { provider: string; model: string };
  /** Defaults to `ASSEMBLER_VERSION`; injectable so a test can move it. */
  assemblerVersion: string;
  /**
   * The linked issue, with its TEXT — digested here, never stored.
   *
   * Taking the content rather than a precomputed digest is deliberate: a caller
   * that had to digest it itself is a caller that can forget to, or can digest
   * the wrong field, and the failure mode is a fingerprint that never moves.
   */
  issue: { number: number; state?: string | null; title?: string | null; body?: string | null } | null | undefined;
  /** Every reference document that entered the input, with its text. */
  documents: readonly { source: string; content: string }[];
}

/** SHA-256, truncated. A change detector, never a payload. */
function digest(text: string, chars: number = DIGEST_CHARS): string {
  return createHash('sha256').update(text).digest('hex').slice(0, chars);
}

/** The eight local components, in `MovedInput`'s vocabulary. */
export function localComponents(input: FingerprintInput): LocalComponents {
  return {
    head_sha: input.headSha ?? NONE,
    intent_derived_at: input.intent?.derived_at ?? NONE,
    intent_model: input.intent?.model ?? NONE,
    indexed_sha: input.blast?.indexed_sha ?? NONE,
    blast_state: input.blast?.state ?? NONE,
    model_provider: input.model.provider,
    model_id: input.model.model,
    assembler_version: input.assemblerVersion,
  };
}

/**
 * The two remote components. Both are digests of content plus the identifiers
 * that name where the content came from.
 *
 * Documents are SORTED by source before joining: the resolver returns them in
 * `repo-file → github → url` order, but a set of documents that resolved in a
 * different order is the same set, and a fingerprint that moved because of
 * ordering would force a needless model call.
 */
export function remoteComponents(input: FingerprintInput): RemoteComponents {
  const issue = input.issue
    ? [
        `#${input.issue.number}`,
        input.issue.state ?? NONE,
        digest(`${input.issue.title ?? ''}\n\n${input.issue.body ?? ''}`),
      ].join('|')
    : NONE;

  const docs = [...input.documents]
    .map((d) => `${d.source}|${digest(d.content)}`)
    .sort()
    .join(',');

  return { linked_issue: issue, documents: docs || NONE };
}

/**
 * Canonical serialisation for hashing: keys sorted, values joined with a
 * separator that cannot appear in a key.
 *
 * Sorting is what makes "same inputs, different key order → same digest" true,
 * and joining `key=value` rather than concatenating values is what stops two
 * different component sets colliding by shifting a character across a boundary.
 */
function canonical(components: Record<string, string>): string {
  return Object.keys(components)
    .sort()
    .map((key) => `${key}=${components[key]}`)
    .join('\n');
}

/** Full-length SHA-256 of a component record. */
function hash(components: Record<string, string>): string {
  return createHash('sha256').update(canonical(components)).digest('hex');
}

/**
 * REQ-8's fingerprint: one digest per half, over all ten components.
 *
 * Comparing the pair for equality is the cache check at assembly time (all ten);
 * comparing `local` alone is the freshness check at read time (eight of ten).
 */
export function computeFingerprint(input: FingerprintInput): BriefFingerprint {
  return {
    local: hash(localComponents(input)),
    remote: hash(remoteComponents(input)),
  };
}

/**
 * Which of the eight local components differ — REQ-14's marker, in
 * `MovedInput`'s vocabulary.
 *
 * It compares two COMPONENT RECORDS, not two digests, because a digest can only
 * ever say "something moved". Returned in `MovedInput`'s declared order rather
 * than in discovery order, so the marker reads the same way twice.
 *
 * It can only ever name a local component. That is not a limitation to fix: the
 * read path has no way to observe a remote one move without the outbound call
 * D-1a rules out, so a vocabulary that could name one would be a marker we could
 * never raise.
 */
export function describeMoved(stored: LocalComponents, current: LocalComponents): MovedInput[] {
  return MovedInput.options.filter((key) => stored[key] !== current[key]);
}

/**
 * What actually goes in the single `pr_brief.state_fingerprint` text column.
 *
 * Both digests, plus the local component RECORD. The record is what makes
 * REQ-14 answerable: a stored digest can say a brief is stale, but only the
 * stored values can say `head_sha` and `indexed_sha` are the ones that moved.
 * The values are identifiers, timestamps and our own version strings — the same
 * class of value the digests are built from, and never input content.
 *
 * `BriefFingerprint.parse` over this object yields exactly `{local, remote}`
 * (zod strips unknown keys), so the HTTP envelope is unaffected by the extra
 * field and the contract needs no change.
 */
export const StoredFingerprint = z.object({
  local: z.string(),
  remote: z.string(),
  local_components: LocalComponents,
});
export type StoredFingerprint = z.infer<typeof StoredFingerprint>;

export function serializeFingerprint(
  fingerprint: BriefFingerprint,
  components: LocalComponents,
): string {
  return JSON.stringify({ ...fingerprint, local_components: components });
}

/**
 * Read a stored fingerprint back.
 *
 * Returns `null` for anything that does not parse — a row written before this
 * feature, a truncated value, a hand-edited one. The caller's correct response
 * to `null` is to treat the brief as unfingerprinted (and therefore out of
 * date), never to throw: a stored brief that cannot prove its freshness is
 * still a brief someone can read.
 */
export function parseStoredFingerprint(raw: string | null | undefined): StoredFingerprint | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StoredFingerprint.safeParse(json);
  return parsed.success ? parsed.data : null;
}
