import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Skill } from '@devdigest/shared';

/**
 * L02 — skills data-access. The ONLY layer touching the DB for the skills
 * domain. Owns `skills` and `skill_versions`.
 *
 * Every query is scoped by `workspaceId`; `skill_versions` is reached only via a
 * skill already resolved in that scope, so a version row cannot be read across
 * tenants.
 */

export type SkillRow = typeof t.skills.$inferSelect;

/** Row → contract. Keeps Drizzle types from crossing this boundary. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: Skill['type'];
  source: Skill['source'];
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export class SkillRepository {
  constructor(private db: Db) {}

  list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async findByName(workspaceId: string, name: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row;
  }

  /** Insert a skill AND snapshot version 1 — the history is never retro-filled. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();

    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: row!.version, body: row!.body });

    return row!;
  }

  /**
   * Update a skill. A BODY change bumps the version and snapshots it; renames,
   * description edits and enable/disable do not — the version tracks what agents
   * were actually told, and only the body reaches a prompt.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: Partial<Pick<SkillRow, 'name' | 'description' | 'type' | 'body' | 'enabled'>>,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({ ...patch, ...(bodyChanged ? { version: nextVersion } : {}) })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) {
      await this.db
        .insert(t.skillVersions)
        .values({ skillId: row.id, version: row.version, body: row.body });
    }
    return row;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return deleted.length > 0;
  }

  listVersions(skillId: string): Promise<(typeof t.skillVersions.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(asc(t.skillVersions.version));
  }
}
