import type { ReviewRecord, RunSummary } from '@devdigest/shared';
import { Deadline, apiGet } from './api.js';

/**
 * Wait for started review runs to finish, then read what they produced.
 *
 * This exists because `POST /pulls/:id/review` is FIRE-AND-FORGET: it creates
 * the `agent_run` rows, launches the executor with `void`, and returns
 * `reviews: []` literally every time
 * (`server/src/modules/reviews/service.ts:131-137`). Anything that wants an
 * outcome has to poll for it.
 *
 * One implementation, two callers — the `run_review` MCP tool and the
 * `devdigest review` CLI. They must agree on what "finished" means, and on how
 * politely they ask.
 */

/** `RunSummary.status` is a free-form string: running | done | failed | cancelled. */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/**
 * Backoff, not a flat interval. The API's global limit is 120 requests/minute
 * (`server/src/app.ts:96`); polling once a second would spend the entire budget
 * on a single call.
 */
const POLL_MIN_MS = 1_000;
const POLL_MAX_MS = 5_000;
const POLL_GROWTH = 1.4;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface WaitResult {
  /** Terminal run rows for the ids we started, or `null` if the budget expired. */
  runs: RunSummary[] | null;
  /** Reviews belonging to those runs. Empty when `runs` is null. */
  reviews: ReviewRecord[];
}

/**
 * Poll `GET /pulls/:id/runs` until every id in `runIds` is terminal, then read
 * `GET /pulls/:id/reviews` and keep the records those runs produced.
 *
 * Returns `runs: null` when the deadline expires — the caller must report that
 * as "still running", never as a failure: abandoning the poll cannot cancel the
 * run, because the executor never observed the HTTP request in the first place.
 */
export async function waitForRuns(
  prId: string,
  runIds: Set<string>,
  deadline: Deadline,
): Promise<WaitResult> {
  let wait = POLL_MIN_MS;

  while (!deadline.expired()) {
    await sleep(Math.min(wait, deadline.remaining()));
    wait = Math.min(Math.round(wait * POLL_GROWTH), POLL_MAX_MS);
    if (deadline.expired()) break;

    const runs = await apiGet<RunSummary[]>(`/pulls/${prId}/runs`, deadline.forHop(10_000));
    const mine = runs.filter((r) => runIds.has(r.run_id));
    if (mine.length === runIds.size && mine.every((r) => TERMINAL.has(r.status ?? ''))) {
      const all = await apiGet<ReviewRecord[]>(
        `/pulls/${prId}/reviews`,
        deadline.forHop(10_000),
      );
      return {
        runs: mine,
        reviews: all.filter((r) => r.run_id !== null && runIds.has(r.run_id)),
      };
    }
  }

  return { runs: null, reviews: [] };
}
