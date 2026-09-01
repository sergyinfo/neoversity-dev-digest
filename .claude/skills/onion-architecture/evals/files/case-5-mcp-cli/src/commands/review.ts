import { readFile } from 'node:fs/promises';

import { reviewDiff, loadAgent } from '@devdigest/reviewer-core';

import type { CommandContext, ReviewOutcome } from '../contracts.js';
import { renderOutcome } from '../format.js';
import { logger } from '../logging.js';

export async function reviewCommand(
  ctx: CommandContext,
  args: { diffPath: string; agent?: string }
): Promise<string> {
  const diff = await readFile(args.diffPath, 'utf8');
  const agent = await loadAgent(args.agent ?? 'default');

  logger.info('reviewing diff locally', { bytes: diff.length, agent: agent.name });

  const outcome: ReviewOutcome = await reviewDiff({
    diff,
    agent,
    model: process.env.DEVDIGEST_MODEL ?? 'claude-sonnet-5',
  });

  return renderOutcome(outcome);
}
