import { sql } from 'drizzle-orm';

import type { Container } from '../../platform/container.js';
import type { Db } from '../../db/client.js';
import { conventionCache } from '../conventions/state.js';
import { enqueue } from '../../platform/jobs.js';
import type { Insight, InsightStore } from './contract.js';

export class InsightService {
  constructor(
    private readonly store: InsightStore,
    private readonly container: Container,
    private readonly db: Db
  ) {}

  async refresh(workspaceId: string, repoId: string): Promise<Insight[]> {
    const summary = await this.container.repoIntel.summarize(workspaceId, repoId);

    const stale = await this.db.execute(
      sql`SELECT id FROM insights
          WHERE workspace_id = ${workspaceId}
            AND repo_id = ${repoId}
            AND updated_at < now() - interval '30 days'
            AND superseded_by IS NULL`
    );

    for (const row of stale.rows) {
      await this.store.supersede(row.id as string, summary.id);
    }

    conventionCache.set(`${workspaceId}:${repoId}`, summary.conventions);
    await enqueue('insights.reindex', { workspaceId, repoId });

    return this.store.active(workspaceId, repoId);
  }
}
