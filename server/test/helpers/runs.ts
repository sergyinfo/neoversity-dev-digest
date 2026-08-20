import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/**
 * Wait for a run's TRACE, not just for the run to reach a terminal status.
 *
 * `run-executor` calls `completeAgentRun` BEFORE `saveRunTrace`, so a run is
 * already 'done' for a moment while `run_traces` is still empty. Reading the
 * trace straight after `waitForPrRuns` is therefore a race, and it is the one
 * that made `reviews.it.test.ts`'s skills assertion flaky under load — it only
 * loses the race when the suite runs its files in parallel.
 *
 * Returns whatever the last poll saw once `timeoutMs` elapses, so a genuinely
 * missing trace still fails on the caller's own assertion rather than here.
 */
export async function waitForTrace<T = unknown>(
  app: { inject: (o: { method: string; url: string }) => Promise<{ json: <R>() => R }> },
  runId: string,
  timeoutMs = 10_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json<T>();
    if ((trace as { prompt_assembly?: unknown } | null)?.prompt_assembly) return trace;
    if (Date.now() - start > timeoutMs) return trace;
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) return runs;
    await new Promise((r) => setTimeout(r, 25));
  }
}
