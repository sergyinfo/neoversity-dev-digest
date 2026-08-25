/** `run_review` — run one (or every) review agent against a pull request. */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ReviewRunResponse, Severity } from '@devdigest/shared';
import { Deadline, REVIEW_TIMEOUT_MS, apiGet, apiPost } from '../api.js';
import { guard, ok, oneLine } from '../format.js';
import { resolveAgent, resolvePr } from '../resolve.js';
import { waitForRuns } from '../review-wait.js';

const SEVERITIES: Severity[] = ['CRITICAL', 'WARNING', 'SUGGESTION'];

export function registerRunReview(server: McpServer): void {
  server.registerTool(
    'run_review',
    {
      title: 'Run a review agent on a pull request',
      description:
        "Run a DevDigest review agent against a pull request and return each agent's verdict, score and finding counts. Blocking: waits for the run, up to 120 seconds. Calls a paid LLM and creates a new run on every call — to re-read a review that already exists, use get_findings instead.",
      inputSchema: z.object({
        repo: z.string().describe('Repository as "owner/name", e.g. "acme/payments-api"'),
        pr: z.number().int().positive().describe('Pull request number on GitHub, e.g. 482'),
        agent: z
          .string()
          .optional()
          .describe('Agent name from list_agents. Omit to run every enabled agent.'),
      }),
      // Not read-only: this spends money on an LLM call and writes a review row.
      // Not idempotent either — each call creates a new run.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, agent }) =>
      guard(async () => {
        const deadline = new Deadline(REVIEW_TIMEOUT_MS);
        const { repo: repoRow, pr: prRow } = await resolvePr(repo, pr);

        // MANDATORY, not an optimisation. `POST /repos/:id/poll` imports PR
        // metadata only; the file patches land in `pr_files` solely via
        // `GET /pulls/:id`. Reviewing without this warm-up silently reviews an
        // EMPTY diff and returns "approve / score 100" for a few hundredths of
        // a cent. See server/INSIGHTS.md (2026-08-02) and
        // server/src/modules/reviews/diff-loader.ts:19-29.
        await apiGet(`/pulls/${prRow.id}`, deadline.forHop());

        const target = agent ? await resolveAgent(agent) : null;
        if (target && !target.enabled) {
          return ok(
            `Agent "${target.name}" is disabled — enable it in the web app before running a review.`,
          );
        }

        const body = target ? { agentId: target.id } : { all: true };
        const started = await apiPost<ReviewRunResponse>(
          `/pulls/${prRow.id}/review`,
          body,
          deadline.forHop(),
        );

        // `POST /pulls/:id/review` is FIRE-AND-FORGET: it creates the agent_run
        // rows, kicks the executor off with `void`, and returns `reviews: []`
        // literally every time (server/src/modules/reviews/service.ts:131-137).
        // So the run ids are the only usable output, and the tool has to poll
        // for the outcome itself. Rendering the returned `reviews` would report
        // "no review was produced" on every successful run.
        const wanted = new Set(started.runs.map((r) => r.run_id));
        if (wanted.size === 0) {
          const who = target ? `agent "${target.name}"` : 'any enabled agent';
          return ok(
            `No run was started for ${repoRow.full_name} #${pr} by ${who}. ` +
              'Check that at least one agent is enabled (list_agents).',
          );
        }

        const { runs: finished, reviews } = await waitForRuns(prRow.id, wanted, deadline);

        if (finished === null) {
          const names = started.runs.map((r) => r.agent_name).join(', ');
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `The review of ${repoRow.full_name} #${pr} WAS STARTED (${names}) and is still running — ` +
                  `it did not fail. This tool stopped waiting after ${Math.round(REVIEW_TIMEOUT_MS / 1000)}s; ` +
                  'the run continues on the server, because cancelling this call does not cancel it. ' +
                  `Read the result in a minute with get_findings(repo="${repoRow.full_name}", pr=${pr}).`,
              },
            ],
            isError: true,
          };
        }

        const failed = finished.filter((r) => r.status !== 'done');

        const lines = reviews.map((review) => {
          const counts = SEVERITIES.map(
            (s) => `${s[0]}${review.findings.filter((f) => f.severity === s).length}`,
          ).join('/');
          const run = finished.find((r) => r.run_id === review.run_id);
          const cost = run?.cost_usd != null ? ` · $${run.cost_usd.toFixed(4)}` : '';
          const head = `- ${review.agent_name ?? 'agent'} — ${review.verdict ?? 'no verdict'} · score ${
            review.score ?? '—'
          } · ${review.findings.length} finding(s) [${counts}]${cost}`;
          const summary = oneLine(review.summary, 240);
          return summary ? `${head}\n  ${summary}` : head;
        });

        for (const run of failed) {
          lines.push(
            `- ${run.agent_name ?? 'agent'} — run ${run.status}: ${run.error ?? 'no error recorded'}`,
          );
        }

        if (lines.length === 0) {
          return ok(
            `The run(s) on ${repoRow.full_name} #${pr} finished but persisted no review. ` +
              'Inspect the run trace in the web app.',
          );
        }

        return ok(
          `Reviewed ${repoRow.full_name} #${pr} — "${prRow.title}"\n${lines.join('\n')}\n\n` +
            `Call get_findings(repo="${repoRow.full_name}", pr=${pr}) for the individual findings.`,
        );
      }),
  );
}
