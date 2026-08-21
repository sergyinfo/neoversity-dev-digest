import type { SmartDiff, SmartDiffFile, SmartDiffRole, ProposedSplit } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { classifyPath, compareByRisk } from './classify.js';
import {
  ROLE_ORDER,
  SPLIT_TOO_BIG_LINES,
  SPLIT_MIN_FILES,
  SPLIT_GROUP_DEPTH,
} from './constants.js';

/**
 * Smart Diff — orders a PR's changed files by how much they deserve a reviewer's
 * attention.
 *
 * Makes NO model call. It joins two things that already exist by the time it is
 * asked: the files imported with the PR (`pr_files`) and the findings of the
 * most recent review, if one has run. Before any review it still sorts, just
 * without badges — which is why the classifier is path-only.
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  private get repo() {
    return this.container.reviewRepo;
  }

  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    // Ownership first, before any child row is read — `pr_files` and `findings`
    // are scoped transitively through the PR and carry no workspace of their own.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);

    // Latest review only. `reviewsForPull` returns newest-first, and a PR can
    // carry several runs (one per agent, plus re-runs); merging them would show
    // a line flagged by a superseded run as if it were still current.
    const reviews = await this.repo.reviewsForPull(prId);
    const latest = reviews[0];

    const linesByFile = new Map<string, number[]>();
    for (const f of latest?.findings ?? []) {
      const list = linesByFile.get(f.file) ?? [];
      list.push(f.startLine);
      linesByFile.set(f.file, list);
    }

    const classified = files.map((f) => ({
      role: classifyPath(f.path),
      file: {
        path: f.path,
        // Deliberately null: the contract slot exists for a written summary of
        // what a file does, and producing one means asking a model. Smart Diff
        // is defined as making no model call, so it leaves the slot empty rather
        // than inventing a summary from the path.
        pseudocode_summary: null,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        finding_lines: (linesByFile.get(f.path) ?? []).sort((a, b) => a - b),
      } satisfies SmartDiffFile,
    }));

    const groups = ROLE_ORDER.map((role) => ({
      role,
      files: classified
        .filter((c) => c.role === role)
        .map((c) => c.file)
        .sort(compareByRisk),
      // Empty groups are kept, not dropped: the UI renders a stable set of
      // section headers, and "0 files" is a useful answer to "did it find any
      // boilerplate?".
    }));

    return { groups, split_suggestion: this.splitSuggestion(classified) };
  }

  /**
   * Should this PR have been several PRs?
   *
   * `total_lines` is the PR's honest total, so it matches the +/- in the header.
   * The `too_big` DECISION, though, counts only reviewable lines — a 4000-line
   * lock-file refresh is not a PR that needs splitting, and letting it trip the
   * threshold would make the suggestion noise a reviewer learns to ignore.
   */
  private splitSuggestion(
    classified: { role: SmartDiffRole; file: SmartDiffFile }[],
  ): SmartDiff['split_suggestion'] {
    const size = (f: SmartDiffFile) => f.additions + f.deletions;
    const total_lines = classified.reduce((n, c) => n + size(c.file), 0);

    const reviewable = classified.filter((c) => c.role !== 'boilerplate');
    const reviewableLines = reviewable.reduce((n, c) => n + size(c.file), 0);
    const too_big = reviewableLines > SPLIT_TOO_BIG_LINES && reviewable.length >= SPLIT_MIN_FILES;

    if (!too_big) return { too_big: false, total_lines, proposed_splits: [] };

    const byArea = new Map<string, SmartDiffFile[]>();
    for (const { file } of reviewable) {
      const area = file.path.split('/').slice(0, SPLIT_GROUP_DEPTH).join('/');
      byArea.set(area, [...(byArea.get(area) ?? []), file]);
    }

    // One area means there is nothing to cut along — report too_big with no
    // proposal rather than inventing an arbitrary split.
    const proposed_splits: ProposedSplit[] =
      byArea.size < 2
        ? []
        : [...byArea.entries()]
            .map(([name, files]) => ({
              name,
              files: files.map((f) => f.path).sort(),
              weight: files.reduce((n, f) => n + size(f), 0),
            }))
            .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
            .map(({ name, files }) => ({ name, files }));

    return { too_big, total_lines, proposed_splits };
  }
}
