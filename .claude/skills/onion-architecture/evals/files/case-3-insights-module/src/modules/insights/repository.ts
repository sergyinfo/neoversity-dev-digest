import { and, eq, isNull } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import { insights } from '../../db/schema.js';
import type { Insight, InsightStore } from './contract.js';

export class InsightRepository implements InsightStore {
  constructor(private readonly db: Db) {}

  async active(workspaceId: string, repoId: string): Promise<Insight[]> {
    return this.db
      .select()
      .from(insights)
      .where(
        and(
          eq(insights.workspaceId, workspaceId),
          eq(insights.repoId, repoId),
          isNull(insights.supersededBy)
        )
      );
  }

  async supersede(id: string, byId: string): Promise<void> {
    await this.db.update(insights).set({ supersededBy: byId }).where(eq(insights.id, id));
  }
}
