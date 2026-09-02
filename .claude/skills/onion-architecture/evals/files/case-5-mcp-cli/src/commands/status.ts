import { request } from 'undici';

import type { CommandContext } from '../contracts.js';
import { logger } from '../logging.js';

export async function statusCommand(ctx: CommandContext): Promise<string> {
  const res = await request(`${ctx.apiUrl}/health`, {
    method: 'GET',
    headers: { authorization: `Bearer ${ctx.token}` },
  });

  const body = (await res.body.json()) as { status: string; version: string; queue: number };

  console.log(`api ${body.status} (v${body.version}), ${body.queue} jobs queued`);

  logger.debug('health checked', { status: body.status });
  return `${body.status} v${body.version}`;
}
