import type { ReviewRunResponse } from '@devdigest/shared';
import { API_URL, ApiError, Deadline, REVIEW_TIMEOUT_MS, apiPost } from '../api.js';
import { resolveAgent } from '../resolve.js';
import { waitForRuns } from '../review-wait.js';
import { GitError, originFullName, repoRoot, workingTreeDiff } from './git.js';
import { renderFindings } from './render.js';

/**
 * `devdigest review` — run the SAME reviewer the web app runs, against your
 * working tree, before you push.
 *
 * It reuses the reviewer rather than reimplementing it: the diff is POSTed to
 * `/reviews/diff`, which persists it on a synthetic pull request and calls the
 * existing `runReview`. Grounding, agent selection, the run trace and
 * persistence are the production ones. Nothing in this package imports
 * `reviewer-core`, and there is no second review implementation to drift.
 */

/**
 * Exit contract — documented in `--help` because a CLI's exit code is an API.
 *
 *   0  reviewed, no blocking findings
 *   1  reviewed, blocking findings present
 *   2  could not review (bad usage, API down, nothing to review, timed out)
 */
export const EXIT = { CLEAN: 0, BLOCKED: 1, ERROR: 2 } as const;

/**
 * Modes. Only `working` is implemented; the others exist as a shape so adding
 * them later is a new branch rather than a redesign — and so asking for one
 * today fails loudly instead of silently reviewing the wrong thing.
 */
const MODES = ['working', 'staged', 'branch'] as const;
type Mode = (typeof MODES)[number];

const HELP = `devdigest review — review your working tree with the same agents DevDigest runs on a PR

USAGE
  devdigest review [--mode working] [--agent <name>] [--all]

OPTIONS
  --mode <mode>   working (default). 'staged' and 'branch' are not implemented in this release.
  --agent <name>  Agent to run, as shown in the DevDigest web app. Default: every enabled agent.
  --all           Run every enabled agent (the default; accepted for symmetry).
  -h, --help      This text.

WHAT IS REVIEWED
  'git diff HEAD' — staged AND unstaged changes to TRACKED files.
  Untracked files are NOT reviewed: git cannot diff a file it has never seen.
  The count is reported; run 'git add -N <path>' to include one.

EXIT CODES
  0  reviewed, no blocking findings
  1  reviewed, blocking findings present (severity at or above the agent's gate)
  2  could not review — bad usage, API unreachable, empty diff, or timed out

ENVIRONMENT
  DEVDIGEST_API_URL             where the DevDigest API runs (default http://localhost:3001)
  DEVDIGEST_REVIEW_TIMEOUT_MS   how long to wait for the run (default 120000)`;

interface Args {
  mode: Mode;
  agent?: string;
  all: boolean;
}

export function parseArgs(argv: string[]): Args | 'help' {
  const args: Args = { mode: 'working', all: false };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return 'help';
    else if (a === '--all') args.all = true;
    else if (a === '--mode') {
      const v = argv[(i += 1)];
      if (!v || !MODES.includes(v as Mode)) {
        throw new Error(`Unknown --mode "${v ?? ''}". Expected one of: ${MODES.join(', ')}`);
      }
      args.mode = v as Mode;
    } else if (a === '--agent') {
      const v = argv[(i += 1)];
      if (!v) throw new Error('--agent needs a name');
      args.agent = v;
    } else {
      throw new Error(`Unknown argument "${a}". Try --help.`);
    }
  }
  return args;
}

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

export async function main(argv: string[]): Promise<number> {
  let args: Args | 'help';
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return EXIT.ERROR;
  }
  if (args === 'help') {
    out(HELP);
    return EXIT.CLEAN;
  }

  if (args.mode !== 'working') {
    err(`--mode ${args.mode} is not implemented in this release. Use --mode working.`);
    return EXIT.ERROR;
  }

  try {
    const deadline = new Deadline(REVIEW_TIMEOUT_MS);
    const root = await repoRoot();
    const repo = await originFullName(root);
    const { diff, untracked } = await workingTreeDiff(root);

    if (untracked.length > 0) {
      err(
        `${untracked.length} untracked file(s) were NOT reviewed — run 'git add -N <path>' to include them.`,
      );
    }
    if (diff.trim().length === 0) {
      err('No changes to tracked files. Nothing to review.');
      return EXIT.ERROR;
    }

    out(`Reviewing the working tree of ${repo} (${API_URL})…`);

    // The route takes an agent id; the user typed a name. Reuse the MCP
    // resolver so a typo produces the same "here are the valid names" message
    // in both surfaces instead of an opaque 404.
    const agent = args.agent ? await resolveAgent(args.agent) : null;

    const started = await apiPost<ReviewRunResponse & { pr_id: string }>(
      '/reviews/diff',
      {
        repo,
        diff,
        label: 'Working tree',
        ...(agent ? { agentId: agent.id } : { all: true }),
      },
      deadline.forHop(60_000),
    );

    const ids = new Set(started.runs.map((r) => r.run_id));
    if (ids.size === 0) {
      err('No agent was started. Check that at least one agent is enabled in DevDigest.');
      return EXIT.ERROR;
    }

    // The SAME wait the MCP tool uses — see review-wait.ts for why polling is
    // required at all.
    const { runs, reviews } = await waitForRuns(started.pr_id, ids, deadline);

    if (runs === null) {
      err(
        `Timed out after ${Math.round(REVIEW_TIMEOUT_MS / 1000)}s. The review is STILL RUNNING on the server — ` +
          'open the "Working tree" pull request in DevDigest to see it finish.',
      );
      return EXIT.ERROR;
    }

    out(renderFindings(reviews, runs));

    const failed = runs.filter((r) => r.status !== 'done');
    if (failed.length > 0) {
      err(`\n${failed.length} run(s) did not complete: ${failed.map((r) => r.error ?? r.status).join('; ')}`);
      return EXIT.ERROR;
    }

    // "Blocking" is the SERVER's definition — the denormalised blocker count
    // computed from each agent's `ci_fail_on` gate. Recomputing it here would be
    // a second policy that could disagree with the one CI uses.
    const blockers = runs.reduce((n, r) => n + (r.blockers ?? 0), 0);
    if (blockers > 0) {
      out(`\n${blockers} blocking finding(s). Exit 1.`);
      return EXIT.BLOCKED;
    }
    out('\nNo blocking findings. Exit 0.');
    return EXIT.CLEAN;
  } catch (e) {
    if (e instanceof GitError) err(e.message);
    else if (e instanceof ApiError) err(e.message);
    else err(`devdigest review failed: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.ERROR;
  }
}
