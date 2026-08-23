import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Reviewing a RAW diff (the pre-push CLI) through the same path a PR takes.
 *
 * The trick is `pr_files`. `loadDiff` tries `git diff base...head` first and
 * falls through to reconstructing from `pr_files` when that yields no files
 * (`diff-loader.ts:19-29`). A synthetic pull request whose base and head are
 * both `working` can never produce a git diff, so the executor reliably reviews
 * exactly the patches we stored — through the unchanged grounding gate, agent
 * selection, run trace and persistence.
 *
 * That is the whole reason this is not a second reviewer: the CLI reaches the
 * real one by writing the same rows the GitHub importer writes.
 */

export interface DiffFileRow {
  path: string;
  additions: number;
  deletions: number;
  /**
   * Hunks only, WITHOUT the `diff --git` / `---` / `+++` header lines.
   *
   * `diffFromPrFiles` re-adds those three lines itself, so storing them here
   * would produce a doubled header and a diff the parser reads as empty.
   */
  patch: string;
}

/** The number reserved for a CLI/working-tree pseudo-PR. Real PRs start at 1. */
export const WORKING_TREE_PR_NUMBER = 0;

/**
 * Split a unified diff into per-file rows shaped like `pr_files`.
 *
 * Counts come from the shared parser rather than being recounted here, so the
 * CLI path and the GitHub path agree on what "additions" means.
 */
export function splitDiffByFile(raw: string): DiffFileRow[] {
  const parsed = parseUnifiedDiff(raw);
  const counts = new Map(parsed.files.map((f) => [f.path, f]));

  const rows: DiffFileRow[] = [];
  // Sections start at `diff --git`; the leading split entry is preamble.
  for (const section of raw.split(/^diff --git /m).slice(1)) {
    const header = section.slice(0, section.indexOf('\n'));
    // `a/path b/path` — take the b-side, which is the post-change path.
    const path = header.match(/\sb\/(.+)$/)?.[1]?.trim();
    if (!path) continue;

    const hunkStart = section.search(/^@@ /m);
    if (hunkStart < 0) continue; // pure rename/mode change: nothing to review

    const meta = counts.get(path);
    rows.push({
      path,
      additions: meta?.additions ?? 0,
      deletions: meta?.deletions ?? 0,
      patch: section.slice(hunkStart).replace(/\s+$/, ''),
    });
  }
  return rows;
}
