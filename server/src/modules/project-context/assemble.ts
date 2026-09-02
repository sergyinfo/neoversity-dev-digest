import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { attachmentKey, type ProjectionEntry, type ProjectionOrigin } from './contract.js';
import {
  PROJECT_CONTEXT_BLOCK_SEPARATOR,
  PROJECT_CONTEXT_HEADING,
  PROJECT_CONTEXT_TOKEN_BUDGET,
} from './constants.js';

/**
 * L05 (S7) — THE shared assemble step.
 *
 * ONE function, called by both the projection route (`GET /agents/:id/context/
 * projection`) and the run path (`run-executor.runOneAgent`). That sharing is
 * not tidiness: AC-26 and AC-27 assert that what the page projects and what a
 * run actually sends AGREE EXACTLY — the same total, and the same set of
 * dropped documents. Two implementations of "which documents fit" would be two
 * chances to disagree, and the disagreement would be invisible until someone
 * compared a screenshot with a trace.
 *
 * ## AC-19 lives here
 *
 * A run with no attachments must produce a prompt byte-identical to a
 * pre-feature one. `reviewer-core` guards half of that already — `prompt.ts:106`
 * treats `specs: []` and `specs: undefined` alike — but only half. The other
 * half is that `texts` must never contain an EMPTY string: `['']` has
 * `length > 0`, so it would render `## Project context` wrapping nothing for an
 * agent whose single document happened to be unreadable. So REQ-12's
 * empty-document filter runs HERE, inside the assemble step, before the array is
 * returned — not in the caller, where the next caller would forget it.
 *
 * ## Budget (REQ-13 / D-4)
 *
 * Overflow drops WHOLE documents from the end of the user's order. Never
 * truncates. The house precedent and its reasoning are recorded for the brief
 * (`server/INSIGHTS.md`, 2026-08-28): a document cut mid-sentence can sever a
 * "must not" from its clause and invert it, and half a rule read confidently is
 * worse than a rule known to be missing.
 *
 * A dropped document does NOT stop the loop: a later, smaller document may
 * still fit. That is deliberate — it keeps the projection honest per document
 * rather than per position, which is what AC-27's "the marked set is identical
 * to the set the run records" compares.
 */

/** One resolved document handed to the assembler, in injection order. */
export interface ResolvedDoc {
  path: string;
  /**
   * The repository the path is relative to. Required, and NOT the repo under
   * review: an agent can carry documents from several repositories, and the
   * ones from elsewhere are still listed (as `skipped`). With `path` it forms
   * the document's identity — see `attachmentKey` (fix-brief F3).
   */
  repoId: string;
  /** Direct attachment, or inherited from an enabled linked skill. */
  origin: ProjectionOrigin;
  /** The skill it came through; null for a direct attachment. */
  viaSkillId?: string | null;
  /**
   * The document text, or `null` when it could not be read. A `null` here is
   * already-decided: the caller has classified WHY in `skipReason`.
   */
  content: string | null;
  /** Why it could not be read. Names a path and a cause, never content (§7). */
  skipReason?: string;
}

/** A document that will not be injected, and why. Never carries text. */
export interface AssembleSkip {
  path: string;
  /** Part of the document's identity — see `ResolvedDoc.repoId` (F3). */
  repoId: string;
  reason: string;
}

export interface AssembleResult {
  /** Projection rows, in injection order, one per input document. */
  entries: ProjectionEntry[];
  /**
   * The strings passed to `reviewPullRequest({ specs })`. NEVER contains an
   * empty or whitespace-only string, and is `[]` when nothing survived.
   */
  texts: string[];
  /** Exactly what the engine renders for the section, heading included. */
  sectionText: string;
  /**
   * Token cost of the whole section — HEADING PLUS the joined wrapped blocks.
   *
   * This is the number BQ-1 exists to create. `describePromptAssembly` counts
   * `assembly.specs` (`prompt-log.ts:120-132`), which is the joined blocks
   * WITHOUT the heading, because `prompt.ts:132` puts the heading in `user`. So
   * the existing per-section stat can never equal a projection that includes
   * the heading, as REQ-10 requires. `prompt-log.ts` is deliberately NOT
   * modified — its number keeps its meaning; this one is additional.
   */
  sectionTokens: number;
  /** Documents that could not be read at all. */
  skipped: AssembleSkip[];
  /** Documents dropped because the section budget was full. */
  dropped: AssembleSkip[];
}

export interface AssembleOptions {
  budgetTokens?: number;
}

export function assembleProjectContext(
  docs: readonly ResolvedDoc[],
  tokenizer: Tokenizer,
  opts: AssembleOptions = {},
): AssembleResult {
  const budget = opts.budgetTokens ?? PROJECT_CONTEXT_TOKEN_BUDGET;

  const entries: ProjectionEntry[] = [];
  const skipped: AssembleSkip[] = [];
  const dropped: AssembleSkip[] = [];
  const texts: string[] = [];

  // The heading is part of the section, so it is paid for before the first
  // document — otherwise a projection could promise a fit the run cannot honour.
  // Counted WITH its trailing newline, exactly as it appears in `sectionText`.
  //
  // The running total is a sum of separately-counted pieces while
  // `sectionTokens` counts the joined string. BPE merges only ever shrink a
  // joined count, so the running total is the conservative one: enforcement can
  // drop a document that would just have fitted, never admit one that does not.
  const headingTokens = tokenizer.count(`${PROJECT_CONTEXT_HEADING}\n`);
  let used = headingTokens;
  let survivors = 0;

  for (const doc of docs) {
    const base = {
      path: doc.path,
      repo_id: doc.repoId,
      origin: doc.origin,
      ...(doc.viaSkillId != null ? { via_skill_id: doc.viaSkillId } : {}),
    };

    // REQ-12's filter, INSIDE the assembler. Whitespace-only counts as empty:
    // a document of three newlines is not project context, and admitting it
    // would put an empty `<untrusted>` block in the prompt.
    if (doc.content == null || doc.content.trim().length === 0) {
      const reason = doc.skipReason ?? 'empty document';
      skipped.push({ path: doc.path, repoId: doc.repoId, reason });
      entries.push({ ...base, outcome: 'skipped' });
      continue;
    }

    // Measure the document exactly as the engine will render it — the wrapper
    // is part of the cost (D-9), and `wrapUntrusted` is imported from
    // reviewer-core rather than restated so the blocks are byte-identical.
    // The index is the position among SURVIVORS, matching `prompt.ts:108`'s
    // `map((s, i) => wrapUntrusted('spec-' + i, s))`.
    const block = wrapUntrusted(`spec-${survivors}`, doc.content);
    // A block after the first also costs the separator that joins it.
    const separator = survivors > 0 ? PROJECT_CONTEXT_BLOCK_SEPARATOR : '';
    const cost = tokenizer.count(separator + block);

    if (used + cost > budget) {
      dropped.push({
        path: doc.path,
        repoId: doc.repoId,
        reason: `dropped for budget (${budget} tokens)`,
      });
      entries.push({ ...base, tokens_estimate: cost, outcome: 'dropped_budget' });
      continue;
    }

    used += cost;
    survivors += 1;
    texts.push(doc.content);
    entries.push({ ...base, tokens_estimate: cost, outcome: 'injected' });
  }

  const specsBlock = texts.map((s, i) => wrapUntrusted(`spec-${i}`, s)).join(
    PROJECT_CONTEXT_BLOCK_SEPARATOR,
  );

  // Zero survivors ⇒ zero section, zero tokens. Not "a heading with nothing
  // under it" — the engine omits the section entirely for an empty `specs`, and
  // a projection claiming the heading's tokens for a run that will not send it
  // would break AC-26 in the one case it is easiest to get wrong.
  const sectionText = texts.length > 0 ? `${PROJECT_CONTEXT_HEADING}\n${specsBlock}` : '';
  const sectionTokens = texts.length > 0 ? tokenizer.count(sectionText) : 0;

  return { entries, texts, sectionText, sectionTokens, skipped, dropped };
}

/**
 * `RunTrace.specs_read` (REQ-14): EVERY attachment, in injection order —
 * injected ones as a bare path, skipped and dropped ones as path + reason.
 *
 * The contract shape is unchanged (`z.array(z.string())`), so a consumer that
 * does not parse the reason still renders a useful path, which is exactly what
 * `TraceBody.tsx` does today.
 *
 * Lives here rather than in the service because it is a pure function of an
 * `AssembleResult` and because §7's safety rule — "a reason names a path and a
 * cause, never content" — is asserted against it mechanically in
 * `prompt-log.test.ts`, beside the repo's other planted-secret guards.
 *
 * The reason map is keyed by `(repoId, path)`, not by `path` (fix-brief F3):
 * an agent holding `docs/prd.md` in two repositories produces two entries with
 * the same path and DIFFERENT causes — typically one dropped for budget and one
 * skipped as cross-repo — and a path-keyed map silently reported whichever was
 * written last for both of them.
 */
export function specsReadFor(result: AssembleResult): string[] {
  const reasons = new Map<string, string>();
  for (const s of [...result.skipped, ...result.dropped]) {
    reasons.set(attachmentKey(s.repoId, s.path), s.reason);
  }
  return result.entries.map((e) => {
    const reason =
      e.outcome === 'injected' ? undefined : reasons.get(attachmentKey(e.repo_id, e.path));
    return reason ? `${e.path} — ${reason}` : e.path;
  });
}
