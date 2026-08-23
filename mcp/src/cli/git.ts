import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The local git facts the pre-push review needs.
 *
 * `execFile`, never a shell: every value here ends up in a command line and some
 * of them (branch names, remotes) come from a repository we did not write.
 */

export class GitError extends Error {}

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      ...(cwd ? { cwd } : {}),
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw new GitError(
      `git ${args[0]} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    );
  }
}

export async function repoRoot(cwd = process.cwd()): Promise<string> {
  const out = await git(['rev-parse', '--show-toplevel'], cwd);
  return out.trim();
}

/**
 * `owner/name` from `origin`. Handles both SSH and HTTPS remotes, with or
 * without a trailing `.git`.
 */
export async function originFullName(cwd: string): Promise<string> {
  const url = (await git(['remote', 'get-url', 'origin'], cwd)).trim();
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new GitError(`Could not read owner/name from the origin remote: ${url}`);
  return `${m[1]}/${m[2]}`;
}

export interface WorkingTree {
  diff: string;
  /**
   * Files git is not tracking. `git diff HEAD` cannot see them, so they are NOT
   * reviewed — the count is surfaced rather than silently dropped.
   */
  untracked: string[];
}

/**
 * The working tree as one diff.
 *
 * `git diff HEAD` covers staged AND unstaged changes to TRACKED files. It
 * cannot show a file git has never seen, so untracked files are counted and
 * reported instead of being quietly excluded — the difference between "no
 * findings" and "not looked at" is the whole point of this tool.
 */
export async function workingTreeDiff(cwd: string): Promise<WorkingTree> {
  const diff = await git(['diff', 'HEAD'], cwd);
  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], cwd))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return { diff, untracked };
}
