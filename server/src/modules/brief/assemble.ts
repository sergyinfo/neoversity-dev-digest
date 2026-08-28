/**
 * L05 — building the model input for a brief: REQ-2's five sources, REQ-3's
 * header-only guarantee, and REQ-4/REQ-5's token budget.
 *
 * PURE BY DESIGN: no container, no database, no network. Everything arrives
 * resolved and the token counter is injected — the same shape
 * `intent/classifier.ts` uses, and what lets the whole of REQ-3, REQ-4 and
 * REQ-5 be tested without a model or a Postgres.
 *
 * ── THE THREE GUARANTEES ──────────────────────────────────────────────────
 *
 * **1. No source line ever leaves this function (REQ-3).** `pr_files.patch` is
 * read for `@@` headers ONLY. Every `+`, `-` and context line is discarded, and
 * the header is re-rendered from its four captured numbers rather than passed
 * through — because git writes the enclosing function's signature after the
 * closing `@@` (`@@ -10,3 +10,4 @@ export function chargeCard(token) {`), and
 * that tail is source code. Substring-matching the header and keeping the line
 * would leak it; re-rendering the ranges cannot.
 *
 * **2. Every third-party string is fenced (`wrapUntrusted`).** The derived
 * intent, the blast map, the changed-file list, the linked issue and every
 * referenced document originate in text the PR author controls — including the
 * file PATHS, which is why even the changed-file list is fenced. The system
 * prompt states that content inside a fence is data whose instructions are never
 * followed; `wrapUntrusted` neutralises attempts to close the fence early
 * (`reviewer-core/src/prompt.ts:30-34`).
 *
 * **3. Items are dropped WHOLE, in D-8's order, and the assembly always
 * completes (REQ-5).** Never truncated: a document cut mid-sentence can sever a
 * "must not" from its clause and invert it, and half a rule read confidently is
 * worse than a rule known to be missing. Every drop is recorded by SOURCE — a
 * path, a `#N`, a URL, a symbol name — never by content. If everything droppable
 * has been dropped and the input is still over budget, the assembly completes
 * anyway: omit-don't-throw is the house rule (`server/CLAUDE.md`), and a brief
 * built from a slightly-too-large input is worth more than a 500.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * **The PR title and body.** REQ-2 fixes the input at exactly five sources and
 * the PR's own prose is not one of them (§9's input table). It is not lost: the
 * stored intent is derived FROM it, and the PR body is what the reference
 * resolver parsed to find the documents and the issue. Adding it here would be a
 * sixth source, and it would put the single most author-controlled string in the
 * system next to a request for a risk assessment.
 */
import type { Intent } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import type { BlastResponse } from '../blast/contract.js';
import { renderMapForPrompt } from '../blast/summary.js';
import type { ResolvedReference } from '../intent/references.js';
import type { BriefInput, SkippedSource } from './contract.js';
import {
  BRIEF_SYSTEM_PROMPT,
  BUDGET_REASON,
  MAX_BLAST_SYMBOLS,
  MAX_FILES_LISTED,
  MAX_ISSUE_CHARS,
  TOKEN_BUDGET,
} from './constants.js';

/** One `pr_files` row's worth of what the assembler needs. */
export interface BriefChangedFile {
  path: string;
  additions: number;
  deletions: number;
  /** The stored hunk-only patch. Null for a binary or unfetched file. */
  patch?: string | null;
}

/** `pull_requests.additions / deletions / files_count` — counts, ours, trusted. */
export interface BriefDiffStats {
  additions: number;
  deletions: number;
  files_count: number;
}

/** `PrDetail.linked_issue`, resolved live and never persisted. */
export interface BriefLinkedIssue {
  number: number;
  title: string;
  body?: string | null;
  state?: string | null;
}

export interface AssembleInput {
  /** The stored `pr_intent` row's document, read and never derived (D-12). */
  intent: Intent | null;
  /** The blast envelope. Null when no map could be built at all. */
  blast: BlastResponse | null;
  stats: BriefDiffStats;
  files: readonly BriefChangedFile[];
  issue: BriefLinkedIssue | null;
  /** Documents the PR body referenced, already resolved and budget-capped. */
  references: readonly ResolvedReference[];
  /**
   * `container.tokenizer.count`. Injected, and treated as fallible: an encoder
   * that throws must degrade the estimate, never the assembly (REQ-4).
   */
  countTokens?: (text: string) => number;
}

export interface AssembledBriefInput {
  system: string;
  user: string;
  /** `countTokens(system + user)`, or `ceil(chars/4)` if that threw (REQ-4). */
  estimated_input_tokens: number;
  /** Which of the five sources actually reached the model, after drops. */
  inputs_used: BriefInput[];
  /** Source identifiers of the documents that reached the model. */
  references_used: string[];
  /** Whole items left out, by source. Never by content. */
  dropped_items: SkippedSource[];
  /** How many changed-file entries were listed. */
  files_listed: number;
}

/**
 * `@@ -a,b +c,d @@` per hunk, re-rendered from the captured numbers.
 *
 * Exported because it is the single point where REQ-3 is enforced and a test
 * should be able to aim straight at it: anything this function does not return
 * cannot reach the model input.
 */
export function hunkRanges(patch: string | null | undefined): string[] {
  // Re-rendered from the captured numbers, NOT sliced from the line: git appends
  // the enclosing function's signature after the closing `@@`, and that is
  // source code.
  return parseHunks(patch).map(
    (h) => `@@ -${h.oldStart},${h.oldLen} +${h.newStart},${h.newLen} @@`,
  );
}

/** An inclusive line span on the PR-head side of one hunk. */
export interface HeadLineRange {
  start: number;
  end: number;
}

/**
 * The same hunks as `hunkRanges`, as inclusive head-side line spans.
 *
 * Exists so REQ-6 grounding can check a `review_focus[].line` against exactly
 * the ranges the model was shown, without re-parsing the rendered strings. Both
 * functions read one `parseHunks` so the check and the prompt can never
 * disagree about where a hunk is.
 *
 * A pure-deletion hunk (`+c,0`) yields an EMPTY span (`end < start`), which is
 * correct: no line exists there at the head, so no line may be cited there.
 */
export function headLineRanges(patch: string | null | undefined): HeadLineRange[] {
  return parseHunks(patch).map((h) => ({ start: h.newStart, end: h.newStart + h.newLen - 1 }));
}

interface Hunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
}

/** `@@ -a,b +c,d @@` per hunk. An omitted length is `1`, per the diff format. */
function parseHunks(patch: string | null | undefined): Hunk[] {
  if (!patch) return [];
  const hunks: Hunk[] = [];
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    hunks.push({
      oldStart: Number(m[1]),
      oldLen: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newLen: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return hunks;
}

/** Paths, counts and hunk ranges. Never a changed line. */
function renderChangedFiles(
  files: readonly BriefChangedFile[],
  listed: number,
  totalFiles: number,
): string {
  const lines = files.slice(0, listed).map((f) => {
    const ranges = hunkRanges(f.patch).join(' ');
    return `${f.path} (+${f.additions}/-${f.deletions})${ranges ? `\n  ${ranges}` : ''}`;
  });
  const omitted = totalFiles - Math.min(listed, files.length);
  if (omitted > 0) lines.push(`…and ${omitted} more changed file(s), not listed`);
  return lines.join('\n');
}

function renderIntent(intent: Intent): string {
  const lines = [`intent: ${intent.intent}`];
  if (intent.in_scope.length > 0) lines.push(`in scope: ${intent.in_scope.join('; ')}`);
  if (intent.out_of_scope.length > 0) {
    lines.push(`out of scope: ${intent.out_of_scope.join('; ')}`);
  }
  if (intent.confidence) lines.push(`confidence: ${intent.confidence}`);
  if (intent.sources?.length) lines.push(`derived from: ${intent.sources.join(', ')}`);
  return lines.join('\n');
}

function renderIssue(issue: BriefLinkedIssue): string {
  return `${issue.title}\n\n${(issue.body ?? '').slice(0, MAX_ISSUE_CHARS)}`;
}

/**
 * The blast map's symbols in the order `renderMapForPrompt` itself ranks them —
 * most callers first, then most endpoints — with the symbols that reach nothing
 * filtered out exactly as it filters them.
 *
 * Restated here rather than exported from `blast/summary.ts` so the DROP RECORD
 * can be honest: the renderer caps at 12 internally, so handing it 30 symbols
 * would silently render 12 while provenance claimed 30 reached the model.
 */
function rankedSymbols(blast: BlastResponse): BlastResponse['map']['downstream'] {
  return [...blast.map.downstream]
    .filter((d) => d.callers.length > 0 || d.endpoints_affected.length > 0)
    .sort(
      (a, b) =>
        b.callers.length - a.callers.length ||
        b.endpoints_affected.length - a.endpoints_affected.length,
    );
}

/** Mutable state of the assembly while items are being dropped out of it. */
interface Working {
  references: ResolvedReference[];
  issue: BriefLinkedIssue | null;
  symbols: BlastResponse['map']['downstream'];
  filesListed: number;
}

function renderUser(input: AssembleInput, w: Working): string {
  const sections: string[] = [];

  if (input.intent) {
    sections.push(`## Derived intent\n${wrapUntrusted('pr-intent', renderIntent(input.intent))}`);
  }

  sections.push(
    `## Diff statistics\n` +
      `${input.stats.files_count} changed file(s), +${input.stats.additions}/-${input.stats.deletions} line(s)`,
  );

  sections.push(
    `## Changed files (paths, counts and hunk @@ ranges only — no code)\n` +
      wrapUntrusted(
        'changed-files',
        renderChangedFiles(input.files, w.filesListed, input.stats.files_count || input.files.length),
      ),
  );

  if (input.blast) {
    const reduced: BlastResponse = {
      ...input.blast,
      map: { ...input.blast.map, downstream: w.symbols },
    };
    sections.push(`## Dependency map\n${wrapUntrusted('blast-map', renderMapForPrompt(reduced))}`);
  }

  if (w.issue) {
    sections.push(
      `## Linked issue #${w.issue.number}\n${wrapUntrusted('linked-issue', renderIssue(w.issue))}`,
    );
  }

  for (const ref of w.references) {
    sections.push(
      `## Referenced ${ref.kind === 'repo-file' ? 'plan/spec' : 'document'}: ${ref.source}\n` +
        wrapUntrusted(`spec:${ref.source}`, ref.content),
    );
  }

  return sections.join('\n\n');
}

/**
 * Count `system + user`, degrading to `ceil(chars/4)` if the injected counter
 * throws or answers nonsense (REQ-4).
 *
 * The fallback is `approxTokens` from the shipped tokenizer adapter rather than
 * a local copy of the same arithmetic: REQ-4 names that function as the
 * fallback, and two copies of a budget heuristic drift.
 */
function measure(text: string, countTokens?: (text: string) => number): number {
  if (!countTokens) return approxTokens(text);
  try {
    const n = countTokens(text);
    return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : approxTokens(text);
  } catch {
    return approxTokens(text);
  }
}

/**
 * Drop the next whole item in D-8's order, or return `null` when the only
 * things left are ones we refuse to drop.
 *
 * Two floors, both deliberate:
 *  - the blast map keeps its **highest-ranked symbol** — D-8 says "symbols
 *    beyond the highest-ranked", and a map rendered with no symbols reads as
 *    "this change reaches nothing", which is the one thing an empty map must
 *    never be read as (`blast/contract.ts:29-33`);
 *  - the changed-file list keeps **one file** — it is the grounding allow-list,
 *    and an empty allow-list means every reference the model returns is
 *    discarded and the brief cites nothing at all.
 */
function dropNext(w: Working, files: readonly BriefChangedFile[]): SkippedSource | null {
  if (w.references.length > 0) {
    // From the END: the resolver ordered them repo-file → github → url, least
    // trustworthy last, so the last one in is the first one out.
    const ref = w.references.pop()!;
    return { source: ref.source, reason: BUDGET_REASON };
  }
  if (w.issue) {
    const source = `linked-issue #${w.issue.number}`;
    w.issue = null;
    return { source, reason: BUDGET_REASON };
  }
  if (w.symbols.length > 1) {
    const symbol = w.symbols.pop()!;
    return { source: `blast-symbol ${symbol.symbol}`, reason: BUDGET_REASON };
  }
  if (w.filesListed > 1) {
    w.filesListed -= 1;
    const dropped = files[w.filesListed];
    return { source: dropped?.path ?? 'changed-file', reason: BUDGET_REASON };
  }
  return null;
}

/**
 * Build the system and user messages, measure them, and drop whole items until
 * they fit — or until there is nothing left we are willing to drop.
 */
export function assembleBriefInput(input: AssembleInput): AssembledBriefInput {
  const dropped: SkippedSource[] = [];

  const ranked = input.blast ? rankedSymbols(input.blast) : [];
  if (ranked.length > MAX_BLAST_SYMBOLS) {
    dropped.push({
      source: 'blast-map',
      reason: `capped at the ${MAX_BLAST_SYMBOLS} highest-ranked of ${ranked.length} symbols`,
    });
  }

  const totalFiles = input.files.length;
  if (totalFiles > MAX_FILES_LISTED) {
    dropped.push({
      source: 'changed-files',
      reason: `capped at the first ${MAX_FILES_LISTED} of ${totalFiles} changed files`,
    });
  }

  const w: Working = {
    references: [...input.references],
    issue: input.issue,
    symbols: ranked.slice(0, MAX_BLAST_SYMBOLS),
    filesListed: Math.min(totalFiles, MAX_FILES_LISTED),
  };

  let user = renderUser(input, w);
  let estimate = measure(BRIEF_SYSTEM_PROMPT + user, input.countTokens);

  while (estimate > TOKEN_BUDGET) {
    const drop = dropNext(w, input.files);
    // Nothing left we are willing to drop — complete anyway (REQ-5).
    if (!drop) break;
    dropped.push(drop);
    user = renderUser(input, w);
    estimate = measure(BRIEF_SYSTEM_PROMPT + user, input.countTokens);
  }

  const inputs_used: BriefInput[] = [];
  if (input.intent) inputs_used.push('intent');
  // An EMPTY map is not an ABSENT one — `blast` records that we looked.
  if (input.blast) inputs_used.push('blast');
  if (w.filesListed > 0) inputs_used.push('diff');
  if (w.issue) inputs_used.push('linked_issue');
  if (w.references.length > 0) inputs_used.push('references');

  return {
    system: BRIEF_SYSTEM_PROMPT,
    user,
    estimated_input_tokens: estimate,
    inputs_used,
    references_used: w.references.map((r) => r.source),
    dropped_items: dropped,
    files_listed: w.filesListed,
  };
}
