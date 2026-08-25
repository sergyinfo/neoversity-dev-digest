import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L04 — blast data-access. The ONLY layer touching the DB for this module, and
 * it touches nothing repo-intel owns: symbols, references, the import graph and
 * file facts are reached through `container.repoIntel.*`, never from here.
 *
 * Every query is workspace-scoped.
 */

export interface BlastPull {
  id: string;
  repoId: string;
  number: number;
  title: string;
  headSha: string;
}

export interface BlastRepo {
  id: string;
  fullName: string;
}

export interface PriorPrRow {
  number: number;
  title: string;
  author: string;
  updatedAt: Date | null;
  overlappingFiles: string[];
}

export class BlastRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<BlastPull | null> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        headSha: t.pullRequests.headSha,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)))
      .limit(1);
    return row ?? null;
  }

  async getRepo(workspaceId: string, repoId: string): Promise<BlastRepo | null> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .limit(1);
    return row ?? null;
  }

  /** The PR's changed file paths, in stored order. */
  async getChangedFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => r.path);
  }

  /**
   * Other PRs of the same repo that touched at least one of `files`, newest
   * first. Answers "who else has been in here recently?" — history, not index,
   * which is why it lives in this module rather than behind the repo-intel
   * facade.
   */
  async getPriorPrs(
    workspaceId: string,
    repoId: string,
    excludePrId: string,
    files: string[],
    limit: number,
  ): Promise<PriorPrRow[]> {
    if (files.length === 0) return [];

    const rows = await this.db
      .select({
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
        updatedAt: t.pullRequests.updatedAt,
        path: t.prFiles.path,
        prId: t.pullRequests.id,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.prFiles.prId))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          inArray(t.prFiles.path, files),
        ),
      )
      .orderBy(desc(t.pullRequests.updatedAt));

    // Group in JS: one row per (PR, overlapping file) comes back from the join.
    const byPr = new Map<string, PriorPrRow>();
    for (const r of rows) {
      const existing = byPr.get(r.prId);
      if (existing) {
        if (!existing.overlappingFiles.includes(r.path)) existing.overlappingFiles.push(r.path);
        continue;
      }
      if (byPr.size >= limit) continue;
      byPr.set(r.prId, {
        number: r.number,
        title: r.title,
        author: r.author,
        updatedAt: r.updatedAt,
        overlappingFiles: [r.path],
      });
    }
    return [...byPr.values()];
  }
}
