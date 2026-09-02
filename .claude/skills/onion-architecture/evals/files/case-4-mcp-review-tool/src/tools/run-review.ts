import { parseReviewRequest, type Finding, type ToolContext } from '../contracts.js';
import { resolvePull } from '../resolve.js';
import { waitForReview } from '../review-wait.js';
import { logger } from '../logging.js';

export const runReviewTool = {
  name: 'run_review',
  description: 'Run a review agent against a pull request and return its findings.',
  async handler(ctx: ToolContext, input: unknown) {
    const { pullId: slugAndNumber, agent, force } = parseReviewRequest(input);
    const [slug, rawNumber] = slugAndNumber.split('#');
    const pullId = await resolvePull(ctx, slug, Number(rawNumber));

    logger.info('starting review', { pullId, agent });

    const started = await ctx.client.post<{ runId: string }>(`/pulls/${pullId}/review`, {
      agent,
      force: force ?? false,
    });

    const finished = await waitForReview(ctx, started.runId);
    const findings = await ctx.client.get<Finding[]>(`/reviews/${finished.reviewId}/findings`);

    return {
      verdict: finished.verdict,
      score: finished.score,
      findings,
    };
  },
};
