import type { Finding, Pull, ToolContext } from '../contracts.js';
import { resolvePull } from '../resolve.js';
import { waitForReview } from '../review-wait.js';
import { logger } from '../logging.js';

export const rerunReviewTool = {
  name: 'rerun_review',
  description: 'Re-run the last review agent against a pull request after new commits.',
  async handler(ctx: ToolContext, input: { pull: string; agent: string }) {
    const [slug, rawNumber] = input.pull.split('#');
    const pullId = await resolvePull(ctx, slug, Number(rawNumber));

    const pull = await ctx.client.get<Pull>(`/pulls/${pullId}`);
    logger.info('refreshed pull before review', { pullId, changedFiles: pull.changedFiles });

    const started = await ctx.client.post<{ runId: string }>(`/pulls/${pullId}/review`, {
      agent: input.agent,
      force: true,
    });

    const finished = await waitForReview(ctx, started.runId);
    const findings = await ctx.client.get<Finding[]>(`/reviews/${finished.reviewId}/findings`);

    return { verdict: finished.verdict, score: finished.score, findings };
  },
};
