import { and, desc, eq, gte } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import { pulls } from '../../db/schema.js';
import type { DigestEntry, DigestReader } from './contract.js';

export class DigestRepository implements DigestReader {
  constructor(private readonly db: Db) {}

  async entriesSince(workspaceId: string, since: Date, limit: number): Promise<DigestEntry[]> {
    const rows = await this.db
      .select()
      .from(pulls)
      .where(and(eq(pulls.workspaceId, workspaceId), gte(pulls.updatedAt, since)))
      .orderBy(desc(pulls.updatedAt))
      .limit(limit);

    return rows.map((row) => ({
      pullId: row.id,
      title: row.title,
      summary: row.summary ?? '',
      riskScore: row.riskScore ?? 0,
    }));
  }
}
