import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AttachmentRow, AttachmentTargetKind } from './contract.js';

/**
 * L05 (S6) — Project Context data access. The ONLY layer touching the DB for
 * this module.
 *
 * ## Storage shape vs wire shape
 *
 * The table carries two nullable FKs, `agent_id` and `skill_id`, with a CHECK
 * that exactly one is set (plan R1 — a polymorphic `target_id` carries no FK
 * and so cannot cascade, and §7 requires attachments to disappear with their
 * agent or skill). The WIRE shape is `target_kind` + `target_id` (§10). The two
 * are mapped HERE, at the repository boundary, so nothing above this file has
 * to know which column is null.
 *
 * ## Tenancy
 *
 * Every query is scoped by `workspaceId` in SQL. Note that `agent_skills`
 * carries no `workspace_id` of its own — it is a precedent for the ORDERING
 * model only, never the tenancy model — so joins through it are scoped via the
 * `skills` row or the attachment's own `workspace_id`.
 */

export type ContextAttachmentRow = typeof t.contextAttachments.$inferSelect;

/** Storage row → wire shape. `target_kind` is DERIVED from which FK is set. */
export function toAttachmentDto(row: ContextAttachmentRow): AttachmentRow {
  const isAgent = row.agentId != null;
  return {
    id: row.id,
    path: row.path,
    repo_id: row.repoId,
    target_kind: isAgent ? 'agent' : 'skill',
    target_id: (isAgent ? row.agentId : row.skillId) as string,
    order: row.order,
    created_at: row.createdAt?.toISOString() ?? null,
  };
}

/** One document a run would consider, already ordered. */
export interface ResolvedAttachment {
  id: string;
  path: string;
  repoId: string;
  origin: 'agent' | 'skill';
  viaSkillId: string | null;
}

export interface UsageCounts {
  /** Repo-relative path → how many distinct agents use it (direct or inherited). */
  byPath: Record<string, number>;
  /** Skill id → how many agents have that skill LINKED (enabled or not, REQ-9). */
  bySkill: Record<string, number>;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  /** The repo row, workspace-scoped. `null` ⇒ the caller throws NotFoundError. */
  async getRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<typeof t.repos.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return row ?? null;
  }

  /** Workspace-scoped existence check for an attach target. */
  async targetExists(
    workspaceId: string,
    kind: AttachmentTargetKind,
    id: string,
  ): Promise<boolean> {
    if (kind === 'agent') {
      const [row] = await this.db
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.id, id), eq(t.agents.workspaceId, workspaceId)));
      return !!row;
    }
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.id, id), eq(t.skills.workspaceId, workspaceId)));
    return !!row;
  }

  /** Attachments on one target, in injection order. */
  async listForTarget(
    workspaceId: string,
    kind: AttachmentTargetKind,
    targetId: string,
  ): Promise<ContextAttachmentRow[]> {
    const targetCol = kind === 'agent' ? t.contextAttachments.agentId : t.contextAttachments.skillId;
    return this.db
      .select()
      .from(t.contextAttachments)
      .where(
        and(eq(t.contextAttachments.workspaceId, workspaceId), eq(targetCol, targetId)),
      )
      .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path));
  }

  /** Every attachment in one repo — the basis of the list's usage counts. */
  async listForRepo(workspaceId: string, repoId: string): Promise<ContextAttachmentRow[]> {
    return this.db
      .select()
      .from(t.contextAttachments)
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.repoId, repoId),
        ),
      );
  }

  async findById(workspaceId: string, id: string): Promise<ContextAttachmentRow | null> {
    const [row] = await this.db
      .select()
      .from(t.contextAttachments)
      .where(
        and(eq(t.contextAttachments.id, id), eq(t.contextAttachments.workspaceId, workspaceId)),
      );
    return row ?? null;
  }

  async countForTarget(
    workspaceId: string,
    kind: AttachmentTargetKind,
    targetId: string,
  ): Promise<number> {
    const rows = await this.listForTarget(workspaceId, kind, targetId);
    return rows.length;
  }

  async insert(values: {
    workspaceId: string;
    repoId: string;
    kind: AttachmentTargetKind;
    targetId: string;
    path: string;
    order: number;
  }): Promise<ContextAttachmentRow> {
    const [row] = await this.db
      .insert(t.contextAttachments)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId,
        agentId: values.kind === 'agent' ? values.targetId : null,
        skillId: values.kind === 'skill' ? values.targetId : null,
        path: values.path,
        order: values.order,
      })
      .returning();
    return row!;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.contextAttachments)
      .where(
        and(eq(t.contextAttachments.id, id), eq(t.contextAttachments.workspaceId, workspaceId)),
      )
      .returning({ id: t.contextAttachments.id });
    return rows.length > 0;
  }

  /** Set the position of one attachment. Ordering is per row, so two tabs
   * reordering different documents do not clobber each other (§6 Concurrency). */
  async setOrder(workspaceId: string, id: string, order: number): Promise<void> {
    await this.db
      .update(t.contextAttachments)
      .set({ order })
      .where(
        and(eq(t.contextAttachments.id, id), eq(t.contextAttachments.workspaceId, workspaceId)),
      );
  }

  /**
   * Everything one agent would consider, in INJECTION ORDER: the agent's own
   * attachments first, then those inherited from each ENABLED linked skill, in
   * the skill's configured link order, then by attachment order.
   *
   * `skills.enabled = true` is filtered INSIDE the SQL, mirroring
   * `reviews/repository/skill.repo.ts:17-26`, so no caller can forget it. REQ-6
   * is a security-shaped rule — a skill toggled off in the UI must not reach the
   * model — and a filter a caller can omit is not that rule.
   */
  async resolveForAgent(workspaceId: string, agentId: string): Promise<ResolvedAttachment[]> {
    const direct = await this.db
      .select({
        id: t.contextAttachments.id,
        path: t.contextAttachments.path,
        repoId: t.contextAttachments.repoId,
      })
      .from(t.contextAttachments)
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.agentId, agentId),
        ),
      )
      .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path));

    const inherited = await this.db
      .select({
        id: t.contextAttachments.id,
        path: t.contextAttachments.path,
        repoId: t.contextAttachments.repoId,
        skillId: t.contextAttachments.skillId,
      })
      .from(t.contextAttachments)
      .innerJoin(t.skills, eq(t.skills.id, t.contextAttachments.skillId))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.contextAttachments.skillId))
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.agentSkills.agentId, agentId),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(
        asc(t.agentSkills.order),
        asc(t.contextAttachments.order),
        asc(t.contextAttachments.path),
      );

    return [
      ...direct.map((r) => ({ ...r, origin: 'agent' as const, viaSkillId: null })),
      ...inherited.map((r) => ({
        id: r.id,
        path: r.path,
        repoId: r.repoId,
        origin: 'skill' as const,
        viaSkillId: r.skillId,
      })),
    ];
  }

  /**
   * REQ-9's two counts. A NUMBER only (D-3) — no history, no timestamps.
   *
   * The per-document count is over DISTINCT agents, because an agent that both
   * attaches a document directly and inherits it through a skill still uses it
   * once. Computed in JS over two small scoped queries rather than in one SQL
   * UNION: the input is bounded by 20 attachments per target and the intent —
   * "distinct agents" — reads directly.
   */
  async usageCounts(workspaceId: string, repoId: string): Promise<UsageCounts> {
    const direct = await this.db
      .select({ path: t.contextAttachments.path, agentId: t.contextAttachments.agentId })
      .from(t.contextAttachments)
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.repoId, repoId),
          isNotNull(t.contextAttachments.agentId),
        ),
      );

    const inherited = await this.db
      .select({ path: t.contextAttachments.path, agentId: t.agentSkills.agentId })
      .from(t.contextAttachments)
      .innerJoin(t.skills, eq(t.skills.id, t.contextAttachments.skillId))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.contextAttachments.skillId))
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.repoId, repoId),
          eq(t.skills.enabled, true),
        ),
      );

    const pairs = new Set<string>();
    for (const r of [...direct, ...inherited]) {
      if (r.agentId) pairs.add(`${r.path} ${r.agentId}`);
    }
    const byPath: Record<string, number> = {};
    for (const key of pairs) {
      const path = key.slice(0, key.indexOf(' '));
      byPath[path] = (byPath[path] ?? 0) + 1;
    }

    const skillLinks = await this.db
      .select({ skillId: t.agentSkills.skillId, n: sql<number>`count(*)::int` })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.agentSkills.skillId);

    const bySkill: Record<string, number> = {};
    for (const r of skillLinks) bySkill[r.skillId] = Number(r.n);

    return { byPath, bySkill };
  }
}
