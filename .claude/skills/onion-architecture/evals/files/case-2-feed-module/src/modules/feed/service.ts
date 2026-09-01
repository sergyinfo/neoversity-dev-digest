import type { Clock } from '@devdigest/shared';

import { redact } from '../_shared/schemas.js';
import type { FeedItem, FeedQuery, FeedReader } from './contract.js';

export class FeedService {
  constructor(
    private readonly reader: FeedReader,
    private readonly clock: Clock
  ) {}

  async page(query: FeedQuery): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
    const page = await this.reader.page(query);
    const now = this.clock.now();

    return {
      items: page.items
        .filter((item) => item.at <= now)
        .map((item) => ({ ...item, actor: redact(item.actor) })),
      nextCursor: page.nextCursor,
    };
  }
}
