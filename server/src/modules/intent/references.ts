import type { GitClient, GitHubClient, RepoRef, WebFetchClient } from '@devdigest/shared';
import {
  MAX_FILE_REFS,
  MAX_GITHUB_REFS,
  MAX_URL_REFS,
  REFERENCE_BUDGET_BYTES,
  REFERENCE_DOC_DIRS,
} from './constants.js';

/**
 * Reference resolution for the Intent Layer.
 *
 * A PR description often does not state the intent — it POINTS at it: a plan
 * committed in the repo, a linked ticket, a doc somewhere else. This module
 * turns those pointers into text the classifier can read.
 *
 * Split deliberately: `parseReferences` is pure (regex over a string) and is
 * where the security rules live; `resolveReferences` does the I/O through
 * injected ports and is where "best-effort" lives. Every fetch is wrapped —
 * a reference that cannot be read must never fail intent derivation, because
 * intent must still be derivable from indirect signals alone.
 */

export type ReferenceKind = 'repo-file' | 'github' | 'url';

export interface ParsedRef {
  kind: ReferenceKind;
  /** The matched text, for logging and de-duplication. */
  raw: string;
  /** repo-file: repo-root-relative path, already traversal-checked. */
  path?: string;
  /** github: which repo the issue/PR lives in, and its number. */
  owner?: string;
  repo?: string;
  issueNumber?: number;
  /** url: absolute http(s) URL. */
  url?: string;
}

export interface ResolvedReference {
  kind: ReferenceKind;
  /** Human-readable origin, used as the untrusted-block label. */
  source: string;
  content: string;
}

/**
 * A reference that was parsed but produced no content.
 *
 * Previously this only ever reached a log line. It is returned now because a
 * caller that renders references to a human has to be able to say WHY a
 * pointer went unread — "the budget ran out" and "external fetching is off"
 * are different answers, and silently returning fewer items conflates them
 * with "there was nothing to read".
 */
export interface SkippedReference {
  /** The raw matched text, or the resolved source once we had one. */
  source: string;
  reason: string;
}

export interface ResolveResult {
  resolved: ResolvedReference[];
  skipped: SkippedReference[];
}

/** A repo-relative doc path, e.g. `docs/plans/intent.md`. */
const FILE_RE = new RegExp(
  `\\b((?:${REFERENCE_DOC_DIRS.join('|')})/[\\w.\\-/]+\\.(?:md|mdx|txt))`,
  'gi',
);
const GH_URL_RE =
  /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/gi;
const GH_SHORT_RE = /(?:closes|fixes|resolves|refs|see)?\s*#(\d+)\b/gi;
const URL_RE = /https?:\/\/[^\s<>()\[\]"']+/gi;

/** Reject anything that could escape the repo root. */
function isSafeRepoPath(p: string): boolean {
  if (!p || p.startsWith('/') || p.startsWith('\\')) return false;
  if (p.includes('..')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false; // Windows absolute
  if (p.includes('\0')) return false;
  // Must still sit under one of the allow-listed doc directories after parsing —
  // re-checked here rather than trusting the regex that produced it.
  return REFERENCE_DOC_DIRS.some((d) => p.toLowerCase().startsWith(`${d}/`));
}

/**
 * Extract plan/spec/ticket references from a PR body.
 *
 * Code fences are stripped first: a `#123` inside a snippet is a comment, not a
 * ticket, and following it would both waste an API call and pull unrelated text
 * into the intent prompt.
 */
export function parseReferences(body: string | null | undefined, repo: RepoRef): ParsedRef[] {
  if (!body || !body.trim()) return [];
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

  const out: ParsedRef[] = [];
  const seen = new Set<string>();
  const push = (ref: ParsedRef, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  for (const m of text.matchAll(FILE_RE)) {
    const path = m[1]!;
    if (!isSafeRepoPath(path)) continue;
    push({ kind: 'repo-file', raw: path, path }, `file:${path}`);
  }

  const githubUrls = new Set<string>();
  for (const m of text.matchAll(GH_URL_RE)) {
    githubUrls.add(m[0]!);
    const [, owner, name, n] = m;
    push(
      { kind: 'github', raw: m[0]!, owner, repo: name, issueNumber: Number(n) },
      `gh:${owner}/${name}#${n}`,
    );
  }
  for (const m of text.matchAll(GH_SHORT_RE)) {
    const n = Number(m[1]);
    // `#0` is never a real issue, and huge numbers are almost always a false
    // positive (a hex colour, an ID in prose) rather than a ticket.
    if (!Number.isSafeInteger(n) || n <= 0 || n > 1_000_000) continue;
    push(
      { kind: 'github', raw: m[0]!.trim(), owner: repo.owner, repo: repo.name, issueNumber: n },
      `gh:${repo.owner}/${repo.name}#${n}`,
    );
  }

  for (const m of text.matchAll(URL_RE)) {
    const url = m[0]!.replace(/[.,;:]+$/, '');
    if (githubUrls.has(url) || /github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\//i.test(url)) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    push({ kind: 'url', raw: url, url }, `url:${url}`);
  }

  // Caps applied per kind so one spammy kind cannot crowd out the others — a
  // body with 40 URLs must still let its single repo-file plan through.
  const capped: ParsedRef[] = [];
  const limits: Record<ReferenceKind, number> = {
    'repo-file': MAX_FILE_REFS,
    github: MAX_GITHUB_REFS,
    url: MAX_URL_REFS,
  };
  const counts: Record<ReferenceKind, number> = { 'repo-file': 0, github: 0, url: 0 };
  for (const ref of out) {
    if (counts[ref.kind] >= limits[ref.kind]) continue;
    counts[ref.kind]++;
    capped.push(ref);
  }
  return capped;
}

export interface ResolveDeps {
  repoRef: RepoRef;
  git: GitClient;
  /** null when no GitHub PAT is configured. */
  github: GitHubClient | null;
  /** null when external fetching is disabled or unavailable. */
  webFetch: WebFetchClient | null;
  budgetBytes?: number;
  /**
   * When an item does not fit the remaining budget: drop it whole (`true`) or
   * slice it and mark it `…[truncated]` (`false`).
   *
   * Defaults to **false** so the Intent Layer, the original caller, keeps its
   * existing byte-for-byte behaviour. Opt in when the consumer reasons over the
   * document's MEANING rather than sampling it: cutting a document mid-sentence
   * can sever a "must not" from its clause and invert it, and half a rule read
   * confidently is worse than a rule known to be missing.
   */
  dropWholeItems?: boolean;
  log?: {
    info: (msg: string, data?: unknown) => void;
  };
}

/**
 * Fetch each reference, best-effort, within a total content budget.
 *
 * Ordering matters: repo-files and GitHub issues come before external URLs, so
 * when the budget runs out it is the least trustworthy source that gets dropped.
 */
export async function resolveReferences(
  refs: ParsedRef[],
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const budget = deps.budgetBytes ?? REFERENCE_BUDGET_BYTES;
  const order: ReferenceKind[] = ['repo-file', 'github', 'url'];
  const sorted = [...refs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  const resolved: ResolvedReference[] = [];
  const skipped: SkippedReference[] = [];
  let used = 0;

  for (const ref of sorted) {
    if (used >= budget) {
      skipped.push({ source: ref.raw, reason: 'budget' });
      continue;
    }
    let item: ResolvedReference | undefined;
    try {
      item = await fetchOne(ref, deps);
    } catch (err) {
      skipped.push({ source: ref.raw, reason: (err as Error).message });
      continue;
    }
    if (!item) {
      skipped.push({ source: ref.raw, reason: unavailableReason(ref, deps) });
      continue;
    }
    if (!item.content.trim()) {
      skipped.push({ source: ref.raw, reason: 'empty' });
      continue;
    }
    const remaining = budget - used;
    if (Buffer.byteLength(item.content) > remaining) {
      // Two ways to not fit, chosen by the caller — see `dropWholeItems`.
      if (deps.dropWholeItems) {
        skipped.push({
          source: item.source,
          reason: `budget (needs more than the ${remaining}B left of ${budget}B)`,
        });
        deps.log?.info(
          `Intent references: dropped ${item.source} whole — it does not fit the remaining ${remaining}B of the ${budget}B reference budget`,
        );
        continue;
      }
      item = {
        ...item,
        content: `${item.content.slice(0, remaining)}\n…[truncated]`,
      };
      deps.log?.info(
        `Intent references: truncated ${item.source} to fit the ${budget}B reference budget`,
      );
    }
    used += Buffer.byteLength(item.content);
    resolved.push(item);
  }

  deps.log?.info(
    `Intent references: ${resolved.length}/${refs.length} resolved (${used}B)` +
      (skipped.length > 0
        ? `; skipped ${skipped.map((s) => `${s.source} (${s.reason})`).join(', ')}`
        : ''),
  );
  return { resolved, skipped };
}

/**
 * Why `fetchOne` returned nothing, without re-running it.
 *
 * `fetchOne` signals "this port cannot serve this reference" with `undefined`,
 * which used to be reported as `empty` — indistinguishable from a document that
 * really was blank. A missing PAT and a disabled external fetcher are
 * configuration facts the caller can act on, so they are named.
 */
function unavailableReason(ref: ParsedRef, deps: ResolveDeps): string {
  if (ref.kind === 'github' && !deps.github) return 'no github token configured';
  if (ref.kind === 'url' && !deps.webFetch) return 'external fetching disabled';
  return 'unavailable';
}

async function fetchOne(
  ref: ParsedRef,
  deps: ResolveDeps,
): Promise<ResolvedReference | undefined> {
  if (ref.kind === 'repo-file') {
    // Re-validate post-parse: this is the last gate before a filesystem read.
    if (!ref.path || !isSafeRepoPath(ref.path)) return undefined;
    const content = await deps.git.readFile(deps.repoRef, ref.path);
    return { kind: 'repo-file', source: ref.path, content };
  }

  if (ref.kind === 'github') {
    if (!deps.github || !ref.issueNumber || !ref.owner || !ref.repo) return undefined;
    const target = { owner: ref.owner, name: ref.repo };
    // A `#N` reference may be an issue OR a pull request; GitHub 404s the issue
    // endpoint for some PR shapes, so fall back rather than dropping the ref.
    try {
      const issue = await deps.github.getIssue(target, ref.issueNumber);
      return {
        kind: 'github',
        source: `${ref.owner}/${ref.repo}#${ref.issueNumber}`,
        content: `${issue.title}\n\n${issue.body ?? ''}`,
      };
    } catch {
      const pr = await deps.github.getPullRequest(target, ref.issueNumber);
      return {
        kind: 'github',
        source: `${ref.owner}/${ref.repo}#${ref.issueNumber}`,
        content: `${pr.title}\n\n${pr.body ?? ''}`,
      };
    }
  }

  if (!deps.webFetch || !ref.url) return undefined;
  const content = await deps.webFetch.fetch(ref.url);
  return { kind: 'url', source: ref.url, content };
}
