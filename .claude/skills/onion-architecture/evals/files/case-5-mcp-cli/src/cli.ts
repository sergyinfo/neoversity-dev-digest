import { ApiClient } from './client.js';
import type { CommandContext } from './contracts.js';
import { reviewCommand } from './commands/review.js';
import { reviewPrCommand } from './commands/review-pr.js';
import { statusCommand } from './commands/status.js';
import { logger } from './logging.js';

function context(): CommandContext {
  return {
    apiUrl: process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001',
    token: process.env.DEVDIGEST_TOKEN ?? '',
    workspaceId: process.env.DEVDIGEST_WORKSPACE ?? '',
  };
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const ctx = context();
  const client = new ApiClient(ctx.apiUrl, ctx.token);

  switch (command) {
    case 'review':
      process.stdout.write(`${await reviewCommand(ctx, { diffPath: rest[0], agent: rest[1] })}\n`);
      return;
    case 'review-pr':
      process.stdout.write(
        `${await reviewPrCommand(client, ctx, { pullId: rest[0], agent: rest[1] })}\n`
      );
      return;
    case 'status':
      process.stdout.write(`${await statusCommand(ctx)}\n`);
      return;
    default:
      logger.error('unknown command', { command });
      process.exit(2);
  }
}

main(process.argv.slice(2)).catch((err) => {
  logger.error('fatal', { err: String(err) });
  process.exit(1);
});
