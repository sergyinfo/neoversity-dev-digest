import type { ToolContext } from './contracts.js';
import { logger } from './logging.js';

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 8000, 8000];

export interface FinishedReview {
  reviewId: string;
  verdict: 'approve' | 'comment' | 'request_changes';
  score: number;
}

export async function waitForReview(ctx: ToolContext, runId: string): Promise<FinishedReview> {
  for (const delay of BACKOFF_MS) {
    const run = await ctx.client.get<{ status: string; review?: FinishedReview }>(
      `/runs/${runId}`
    );

    if (run.status === 'succeeded' && run.review) {
      return run.review;
    }
    if (run.status === 'failed') {
      throw new Error(`Review run ${runId} failed`);
    }

    logger.debug('review still running', { runId, delay });
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`Review run ${runId} did not finish within the poll budget`);
}
