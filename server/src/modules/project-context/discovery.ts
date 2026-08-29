import { readdir, realpath, stat, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep, extname, isAbsolute } from 'node:path';
import type { SpecFile } from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';
import {
  CONTEXT_DOC_DIR_SEGMENTS,
  CONTEXT_DOC_PATH_PREFIXES,
  MAX_DOC_BYTES,
  MAX_LISTED_DOCS,
  MD_EXTENSIONS,
} from './constants.js';
import type { ContextDocListReason } from './contract.js';

/**
 * L05 (S5) — discovery of repo markdown, and the containment gate every read
 * goes through.
 *
 * ## Why this module does not reuse `isSafeRepoPath`
 *
 * `intent/references.ts:78` has a path guard, and reusing it does NOT satisfy
 * REQ-2. Three independent reasons, all verified against the code:
 *
 *  1. It is not exported — reuse means widening another module's public surface.
 *  2. Its final check is a LEADING-PREFIX match (`:88`), and D-2a settled that
 *     project context matches ANY path segment. Reused unmodified it discovers
 *     nothing in a repo laid out like this one; reused modified it changes
 *     Intent Layer behaviour, which is out of scope.
 *  3. **It is a string check, and the threat is not a string.** There is no
 *     `realpath` call anywhere else in `server/src` or `reviewer-core/src`, and
 *     the read path has no containment of its own: `GitClient.readFile` is a
 *     bare `readFile(join(clonePath, path))` (`adapters/git/simple-git.ts:142`).
 *     A clone containing `docs/vendor-notes -> /etc` yields
 *     `docs/vendor-notes/passwd.md`: no `..`, not absolute, no null byte, under
 *     an allow-listed segment. Every string check passes and an arbitrary host
 *     file is read into a model prompt.
 *
 * ## Why containment sits at the READ, not only at attach
 *
 * An attachment stores a path, not content, and the clone advances
 * independently via `POST /repos/:id/resync`. Validating only at attach time is
 * a TOCTOU hole across a resync: a path that was a regular file on Monday can
 * be a symlink on Tuesday. So `safeDocPath()` — string checks PLUS a `realpath`
 * containment against the clone root — is called immediately before every read,
 * by both the projection route and the run path.
 */

const EXCLUDED_SET = new Set<string>(EXCLUDED_DIRS);
const MD_SET = new Set(MD_EXTENSIONS);

/** Which allow-list predicates to apply. Injectable so each can be tested alone. */
export interface AllowList {
  /** Matched per path SEGMENT (D-2a). */
  dirSegments?: readonly string[];
  /** Matched as a leading path PREFIX (REQ-2's second predicate, F2). */
  pathPrefixes?: readonly string[];
}

/** A file qualifies when SOME directory segment of its path is allow-listed. */
export function hasAllowedSegment(rel: string, segments: readonly string[]): boolean {
  const parts = rel.toLowerCase().split('/');
  // `slice(0, -1)` — the last part is the filename. A file called `docs` could
  // never reach here anyway (extension gate), but matching only directories is
  // what the predicate actually means.
  return parts.slice(0, -1).some((seg) => segments.includes(seg));
}

/**
 * A file qualifies when its path starts with an allow-listed prefix.
 *
 * Separate from the segment predicate on purpose (F2): `.devdigest/specs` is a
 * two-segment string and can never equal one segment, so an entry for it in the
 * segment list does nothing at all while looking like it does something.
 */
export function hasAllowedPrefix(rel: string, prefixes: readonly string[]): boolean {
  const lower = rel.toLowerCase();
  return prefixes.some((p) => lower.startsWith(p.toLowerCase()));
}

function isAllowed(rel: string, allow: AllowList): boolean {
  const segments = allow.dirSegments ?? CONTEXT_DOC_DIR_SEGMENTS;
  const prefixes = allow.pathPrefixes ?? CONTEXT_DOC_PATH_PREFIXES;
  return hasAllowedSegment(rel, segments) || hasAllowedPrefix(rel, prefixes);
}

/**
 * THE allow-list predicate — "would the walk list this path?" — as one function
 * every gate calls (fix-brief F1).
 *
 * It bundles the three rules that used to live only inside `walkDir`:
 * the `.md`/`.mdx` extension filter, the `EXCLUDED_DIRS` skip, and the
 * doc-directory allow-list itself. Keeping them in the walk alone made the
 * listing the ONLY place they applied, while `attach()` and `readDoc()` — the
 * two gates that actually feed the model — checked containment and nothing
 * else. Any file inside the clone could therefore be attached and read,
 * including `.git/config`, which holds the PAT `withGitHubToken` embeds in the
 * clone URL (`repos/helpers.ts:29-40`).
 *
 * REQ-2 states the allow-list AS PART OF the security requirement, so it is
 * enforced with the containment check rather than beside it: `safeDocPath`
 * calls this, which means no caller can apply one half without the other.
 *
 * `EXCLUDED_DIRS` is re-checked here rather than relied on from the walk's
 * directory pruning, because a path handed in from the database never went
 * through that pruning — and `node_modules/pkg/docs/x.md` has an allow-listed
 * `docs` segment.
 */
export function isDiscoverableDocPath(rel: string, allow: AllowList = {}): boolean {
  if (!MD_SET.has(extname(rel).toLowerCase())) return false;
  // `slice(0, -1)` — directory segments only; the last part is the filename.
  if (rel.split('/').slice(0, -1).some((seg) => EXCLUDED_SET.has(seg))) return false;
  return isAllowed(rel, allow);
}

// ---------------------------------------------------------------------------
// The clone root, resolved once per request, classifying its own failure (F3)
// ---------------------------------------------------------------------------

export type CloneRoot =
  | { ok: true; root: string }
  | { ok: false; reason: ContextDocListReason };

/**
 * Resolve the clone root to a real path, once per request.
 *
 * THREE OUTCOMES, and the third is why this helper exists (cross-review F3):
 *  - `clonePath` is null      ⇒ `not_cloned`, no filesystem call at all.
 *  - `realpath` throws ENOENT ⇒ `clone_missing`. `clone_path` is set but the
 *    directory is gone: a broken local state a resync repairs. AC-2 requires an
 *    empty list with a reason here, not a 500 — and a `realpath` that throws
 *    would otherwise become exactly that 500, since the copied walk's
 *    per-directory catch (`walk.ts:79-86`) does not cover this new call.
 *  - any other error (EACCES, ELOOP, ENOTDIR) ⇒ **rethrown**, so §6's "Clone
 *    unreadable" handling still applies. Swallowing a permissions failure as
 *    "missing" would report a fixable configuration problem as a broken clone.
 *
 * Resolving to a REAL path (not just `resolve()`) matters for the containment
 * check below: if the clone root is itself reached through a symlink, comparing
 * a realpath'd file against a non-realpath'd root would reject every legitimate
 * document.
 */
export async function resolveCloneRoot(clonePath: string | null | undefined): Promise<CloneRoot> {
  if (!clonePath) return { ok: false, reason: 'not_cloned' };
  try {
    return { ok: true, root: await realpath(clonePath) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: 'clone_missing' };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The path gate
// ---------------------------------------------------------------------------

/**
 * Pure string checks on a repo-relative path — no filesystem access.
 *
 * This is the ATTACH-time gate (AC-5 ⇒ 422). It is necessary and NOT sufficient:
 * `safeDocPath` re-runs it and adds the containment check that catches what a
 * string can't express.
 */
export function isSafeRelPath(p: string): boolean {
  if (!p || p.trim().length === 0) return false;
  if (p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (isAbsolute(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false; // Windows drive-absolute
  // Any `..` segment, not merely a leading one.
  if (p.split(/[/\\]/).some((seg) => seg === '..')) return false;
  return true;
}

/**
 * The read gate: string checks, the ALLOW-LIST, and a `realpath` containment
 * check against an already-resolved clone root. Returns the absolute path to
 * read, or `null` when the document must not be opened.
 *
 * Returns `null` rather than throwing because every caller's contract is
 * "skip it and record the reason" (REQ-12) — an unreadable document must never
 * cost a run.
 *
 * The allow-list check (F1) sits here rather than in each caller so that a path
 * the walk would never list cannot be read by ANY route or by the run path,
 * including one that was stored in `context_attachments` before the check
 * existed. Containment alone is not the requirement: `.git/config` is perfectly
 * contained and holds the GitHub PAT.
 *
 * Note the ordering: `realpath` is called on the CANDIDATE, and the result is
 * compared to the root. Checking the string first and opening later would be
 * the TOCTOU this whole helper exists to close.
 */
export async function safeDocPath(
  root: string,
  rel: string,
  allow: AllowList = {},
): Promise<string | null> {
  if (!isSafeRelPath(rel)) return null;
  if (!isDiscoverableDocPath(rel, allow)) return null;
  const candidate = join(root, rel);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    // Missing, dangling symlink, or unreadable — not a document we can read.
    return null;
  }
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Reading one document
// ---------------------------------------------------------------------------

/** Why a document could not be turned into text. Never carries content (§7). */
export type DocReadFailure = 'unsafe_path' | 'over_cap' | 'empty' | 'unreadable';

export type DocRead =
  | { ok: true; content: string; size: number }
  | { ok: false; reason: DocReadFailure };

/**
 * Read one document through the containment gate.
 *
 * `unsafe_path` covers every refusal — a path that fails the string checks, one
 * that is not allow-listed, and one that escapes the clone — deliberately: the
 * caller records a reason in a user-visible trace, and distinguishing "you
 * wrote `..`" from "this resolved outside the clone" tells a probing user which
 * of their attempts got closer. Missing files land here too, since `realpath`
 * cannot resolve them.
 */
export async function readDoc(
  root: string,
  rel: string,
  allow: AllowList = {},
): Promise<DocRead> {
  const abs = await safeDocPath(root, rel, allow);
  if (!abs) return { ok: false, reason: 'unsafe_path' };

  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return { ok: false, reason: 'unreadable' };
    size = st.size;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  // Size-gate BEFORE reading, so an over-cap file is never pulled into memory.
  if (size > MAX_DOC_BYTES) return { ok: false, reason: 'over_cap' };

  let content: string;
  try {
    content = await readFile(abs, 'utf8');
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (content.trim().length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, content, size };
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  files: SpecFile[];
  /** The listing hit `MAX_LISTED_DOCS` and `files` is a prefix of what is on disk. */
  capped: boolean;
}

interface Candidate {
  rel: string;
  size: number;
  mtime: Date;
}

/**
 * List every discoverable markdown document under an ALREADY-RESOLVED clone
 * root, with a token estimate per document.
 *
 * The walk is a direct copy of `repo-intel/pipeline/walk.ts:73-122` — same
 * `withFileTypes` readdir, same unreadable-directory catch, same
 * skip-symlinks-entirely rule (BQ-3/a: no visited-inode set, because a walk
 * that never follows a link cannot loop and cannot leave the tree), same
 * per-file `stat` gate, same POSIX relpath normalisation. Copying a reviewed
 * pattern is deliberate; the genuinely new code in this module is the
 * containment gate above.
 *
 * Over-cap files are LISTED and marked (REQ-2) rather than dropped — a user who
 * cannot find their 2 MB spec in the list learns nothing; one who sees it
 * marked learns why it will not be attached.
 */
export async function discoverDocs(
  root: string,
  tokenizer: Tokenizer,
  allow: AllowList = {},
): Promise<DiscoveryResult> {
  const found: Candidate[] = [];
  await walkDir(root, root, found, allow);

  // Stable, reproducible order, so "the first N when capped" is deterministic
  // and a repeat request yields the same list (AC-7's sibling guarantee).
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const capped = found.length > MAX_LISTED_DOCS;
  if (capped) found.length = MAX_LISTED_DOCS;

  const files: SpecFile[] = [];
  for (const c of found) {
    const overCap = c.size > MAX_DOC_BYTES;
    // An over-cap document is not read: it cannot be attached, so its estimate
    // would be a number nobody may act on, bought with a 2 MB read.
    let tokens: number | undefined;
    if (!overCap) {
      // The same `allow` the walk used — otherwise a listing built with a
      // narrowed allow-list would be re-checked against the default one.
      const read = await readDoc(root, c.rel, allow);
      if (read.ok) tokens = tokenizer.count(read.content);
    }
    files.push({
      path: c.rel,
      size: c.size,
      updated_at: c.mtime.toISOString(),
      over_cap: overCap,
      // Absent rather than 0 when it could not be measured — §10 says a
      // consumer shows "—" and excludes it, which 0 would silently defeat.
      ...(tokens !== undefined ? { tokens_estimate: tokens } : {}),
    });
  }

  return { files, capped };
}

async function walkDir(
  root: string,
  dir: string,
  out: Candidate[],
  allow: AllowList,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly, the
    // way the indexer does, so the listing still covers what CAN be read.
    return;
  }

  for (const entry of entries) {
    // Never follow symlinks: loops, performance, and — the reason that matters
    // here — a link out of the clone is precisely the escape REQ-2 forbids.
    if (entry.isSymbolicLink()) continue;
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walkDir(root, join(dir, name), out, allow);
      continue;
    }
    if (!entry.isFile()) continue;

    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    // ONE predicate, shared with `safeDocPath` (F1), so "what the walk lists"
    // and "what a read will open" cannot drift apart again.
    if (!isDiscoverableDocPath(rel, allow)) continue;

    try {
      const st = await stat(full);
      out.push({ rel, size: st.size, mtime: st.mtime });
    } catch {
      continue;
    }
  }
}
