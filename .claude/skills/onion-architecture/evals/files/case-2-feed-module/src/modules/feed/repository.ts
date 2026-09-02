import { and, desc, eq, lt } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import { feedEvents } from '../../db/schema.js';
import type { FeedItem, FeedQuery, FeedReader } from './contract.js';
import { FEED_MAX_PAGE } from './routes.js';

export class FeedRepository implements FeedReader {
  constructor(private readonly db: Db) {}

  async page(query: FeedQuery): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
    const size = Math.min(query.pageSize, FEED_MAX_PAGE);
    const rows = await this.db
      .select()
      .from(feedEvents)
      .where(
        query.cursor
          ? and(eq(feedEvents.workspaceId, query.workspaceId), lt(feedEvents.id, query.cursor))
          : eq(feedEvents.workspaceId, query.workspaceId)
      )
      .orderBy(desc(feedEvents.id))
      .limit(size + 1);

    const items = rows.slice(0, size).map((row) => ({
      id: row.id,
      kind: row.kind as FeedItem['kind'],
      actor: row.actor,
      at: row.createdAt,
    }));

    return { items, nextCursor: rows.length > size ? items[items.length - 1].id : null };
  }
}
