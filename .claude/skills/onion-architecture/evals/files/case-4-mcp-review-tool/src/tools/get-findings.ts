import type { Finding, ToolContext } from '../contracts.js';
import { resolvePull } from '../resolve.js';
import { waitForReview } from '../review-wait.js';
import { capList } from '../format.js';
import { logger } from '../logging.js';
import { runReviewTool } from './run-review.js';

export const getFindingsTool = {
  name: 'get_findings',
  description: 'Return the findings of the most recent review for a pull request.',
  async handler(ctx: ToolContext, input: { pull: string; agent?: string }) {
    const [slug, rawNumber] = input.pull.split('#');
    const pullId = await resolvePull(ctx, slug, Number(rawNumber));

    const existing = await ctx.client.get<{ reviewId: string | null }>(
      `/pulls/${pullId}/latest-review`
    );

    if (!existing.reviewId) {
      logger.info('no review yet, running one', { pullId });
      const produced = await runReviewTool.handler(ctx, {
        pullId: input.pull,
        agent: input.agent ?? 'default',
      });
      return capList(produced.findings);
    }

    const findings = await ctx.client.get<Finding[]>(
      `/reviews/${existing.reviewId}/findings`
    );
    return capList(findings);
  },
};
