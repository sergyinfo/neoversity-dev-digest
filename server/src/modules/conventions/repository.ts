import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCandidate, ConventionStatus } from '@devdigest/shared';

/**
 * L02 — conventions data-access. The ONLY layer touching the DB for the
 * conventions domain. Every query is workspace-scoped.
 */

export type ConventionRow = typeof t.conventions.$inferSelect;

/** Row → contract. Keeps Drizzle types from crossing this boundary. */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    start_line: row.startLine,
    end_line: row.endLine,
    confidence: row.confidence ?? 0,
    status: row.status,
    accepted: row.status === 'accepted',
  };
}

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category?: string | null;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  startLine: number;
  endLine: number;
  confidence: number;
}

export class ConventionRepository {
  constructor(private db: Db) {}

  listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.rule));
  }

  /** Only accepted candidates — skill assembly must not trust a client-sent list. */
  listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(desc(t.conventions.confidence));
  }

  /**
   * The repo row this module extracts from. `repos` owns the table, but reading
   * one row is cheaper than a cross-module import, which the boundary rules
   * forbid — so conventions keeps its own narrow lookup.
   */
  async getRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<typeof t.repos.$inferSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Replace a repo's candidates with a fresh extraction.
   *
   * Deliberately destructive: a re-scan supersedes the previous run, and keeping
   * both would leave the user reconciling two generations of cards. Accepted
   * decisions are lost with it — surfaced in the UI as a re-scan warning rather
   * than hidden here.
   */
  async replaceForRepo(
    workspaceId: string,
    repoId: string,
    rows: InsertConvention[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
      if (rows.length === 0) return [];
      return tx.insert(t.conventions).values(rows).returning();
    });
  }

  async setStatus(
    workspaceId: string,
    id: string,
    status: ConventionStatus,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ status, accepted: status === 'accepted' })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Edit the rule text (and category) of a candidate before it becomes a skill. */
  async editRule(
    workspaceId: string,
    id: string,
    patch: { rule?: string; category?: string | null },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set(patch)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
