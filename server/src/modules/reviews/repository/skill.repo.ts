import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

// ---- skills linked to an agent --------------------------------------------

/**
 * Bodies of the ENABLED skills linked to an agent, in their configured order.
 *
 * Reviews owns this query rather than calling the agents module: feature modules
 * are independent, and the review pipeline needs only the bodies — not the CRUD
 * surface agents exposes.
 *
 * Disabled skills are filtered here, in SQL, so no caller can forget: a skill
 * toggled off in the UI must not reach the model.
 */
export async function getAgentSkillBodies(db: Db, agentId: string): Promise<string[]> {
  const rows = await db
    .select({ body: t.skills.body })
    .from(t.agentSkills)
    .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
    .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
    .orderBy(asc(t.agentSkills.order));

  return rows.map((r) => r.body);
}
