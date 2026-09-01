import type { ApiClient } from '../client.js';
import type { CommandContext, ReviewOutcome } from '../contracts.js';
import { renderOutcome } from '../format.js';
import { logger } from '../logging.js';

export async function reviewPrCommand(
  client: ApiClient,
  ctx: CommandContext,
  args: { pullId: string; agent?: string }
): Promise<string> {
  const pull = await client.get<{ id: string; changedFiles: number }>(`/pulls/${args.pullId}`);
  logger.info('refreshed pull', { pullId: pull.id, changedFiles: pull.changedFiles });

  const outcome = await client.post<ReviewOutcome>('/reviews/diff', {
    pullId: args.pullId,
    agent: args.agent ?? 'default',
    workspaceId: ctx.workspaceId,
  });

  return renderOutcome(outcome);
}
