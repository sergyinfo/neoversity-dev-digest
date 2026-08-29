/**
 * L05 Project Context — `context_attachments` constraint tests (plan S3).
 *
 * This file exists because of cross-review finding F1: a constraint that no
 * test tries to VIOLATE is a constraint nobody has checked. The table's
 * uniqueness rule is the exact case a naive design gets wrong —
 *
 *   In a standard Postgres unique index NULL is distinct from NULL, so one
 *   four-column unique index on `(agent_id, skill_id, repo_id, path)` would
 *   admit two identical agent attachments, both carrying `skill_id = NULL`.
 *   `db:generate` succeeds and the duplicate lands.
 *
 * — so the design uses two PARTIAL unique indexes instead, one per target
 * kind, resting on a `CHECK (num_nonnulls(agent_id, skill_id) = 1)`. Every one
 * of those three constraints is attacked below, plus the `ON DELETE CASCADE`
 * lifecycle §7 depends on.
 *
 * Docker note (`server/INSIGHTS.md` 2026-08-20): under OrbStack these files
 * FAIL rather than skip unless `DOCKER_HOST` points at the OrbStack socket —
 * `export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('context_attachments: every constraint is attacked', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let otherRepoId: string;
  let agentId: string;
  let otherAgentId: string;
  let skillId: string;

  const insert = (v: {
    repoId?: string;
    agentId?: string | null;
    skillId?: string | null;
    path?: string;
    order?: number;
  }) =>
    pg.handle.db
      .insert(t.contextAttachments)
      .values({
        workspaceId,
        repoId: v.repoId ?? repoId,
        agentId: v.agentId ?? null,
        skillId: v.skillId ?? null,
        path: v.path ?? 'docs/architecture.md',
        order: v.order ?? 0,
      })
      .returning();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const repoRows = await pg.handle.db
      .insert(t.repos)
      .values([
        { workspaceId, owner: 'acme', name: 'ctx', fullName: 'acme/ctx' },
        { workspaceId, owner: 'acme', name: 'other', fullName: 'acme/other' },
      ])
      .returning();
    repoId = repoRows[0]!.id;
    otherRepoId = repoRows[1]!.id;

    const agentRows = await pg.handle.db
      .insert(t.agents)
      .values([
        {
          workspaceId,
          name: 'ctx-agent',
          provider: 'openai' as const,
          model: 'gpt-4o-mini',
          systemPrompt: 'review',
        },
        {
          workspaceId,
          name: 'ctx-agent-2',
          provider: 'openai' as const,
          model: 'gpt-4o-mini',
          systemPrompt: 'review',
        },
      ])
      .returning();
    agentId = agentRows[0]!.id;
    otherAgentId = agentRows[1]!.id;

    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'ctx-skill',
        description: 'a skill that carries context',
        type: 'custom' as const,
        source: 'manual' as const,
        body: 'body',
      })
      .returning();
    skillId = skill!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  // ---------------------------------------------------------------- F1: uniqueness

  it('rejects a duplicate AGENT attachment — the F1 case a 4-column unique index would let through', async () => {
    const [first] = await insert({ agentId, path: 'docs/f1-agent.md' });
    expect(first!.skillId).toBeNull(); // both rows carry skill_id = NULL …

    // … which is precisely why a plain unique index on
    // (agent_id, skill_id, repo_id, path) would NOT catch this.
    await expect(insert({ agentId, path: 'docs/f1-agent.md' })).rejects.toThrow(
      /ctx_att_agent_repo_path_uq/,
    );
  });

  it('rejects a duplicate SKILL attachment', async () => {
    const [first] = await insert({ skillId, path: 'docs/f1-skill.md' });
    expect(first!.agentId).toBeNull();

    await expect(insert({ skillId, path: 'docs/f1-skill.md' })).rejects.toThrow(
      /ctx_att_skill_repo_path_uq/,
    );
  });

  it('the duplicate is rejected regardless of `order` — order is not part of the key', async () => {
    await insert({ agentId, path: 'docs/order.md', order: 0 });
    await expect(
      insert({ agentId, path: 'docs/order.md', order: 7 }),
    ).rejects.toThrow(/ctx_att_agent_repo_path_uq/);
  });

  it('the partial indexes do NOT collide across target kinds, agents, or repos', async () => {
    const path = 'docs/shared.md';
    // Same path attached to an agent AND to a skill: two different rules,
    // neither index sees the other's row.
    await expect(insert({ agentId, path })).resolves.toHaveLength(1);
    await expect(insert({ skillId, path })).resolves.toHaveLength(1);
    // Same path, different agent.
    await expect(insert({ agentId: otherAgentId, path })).resolves.toHaveLength(1);
    // Same agent and path, different repo — §6 forbids cross-repo resolution,
    // so these are genuinely distinct attachments.
    await expect(
      insert({ agentId, path, repoId: otherRepoId }),
    ).resolves.toHaveLength(1);
  });

  // ------------------------------------------------- R1: exactly one target (CHECK)

  it('rejects a row with BOTH agent_id and skill_id set', async () => {
    await expect(
      insert({ agentId, skillId, path: 'docs/both.md' }),
    ).rejects.toThrow(/ctx_att_one_target_ck/);
  });

  it('rejects a row with NEITHER agent_id nor skill_id set', async () => {
    await expect(insert({ path: 'docs/neither.md' })).rejects.toThrow(
      /ctx_att_one_target_ck/,
    );
  });

  // ------------------------------------------------------------ §7: cascade lifecycle

  it('deleting the agent deletes its attachments, and only its own', async () => {
    const [doomedAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'doomed',
        provider: 'openai' as const,
        model: 'gpt-4o-mini',
        systemPrompt: 'review',
      })
      .returning();
    await insert({ agentId: doomedAgent!.id, path: 'docs/cascade-agent.md' });
    const survivor = await insert({ agentId, path: 'docs/cascade-survivor.md' });

    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, doomedAgent!.id));

    const left = await pg.handle.db
      .select({ id: t.contextAttachments.id })
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.agentId, doomedAgent!.id));
    expect(left).toHaveLength(0);

    const stillThere = await pg.handle.db
      .select({ id: t.contextAttachments.id })
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.id, survivor[0]!.id));
    expect(stillThere).toHaveLength(1);
  });

  it('deleting the skill deletes its attachments', async () => {
    const [doomedSkill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'doomed-skill',
        description: 'temporary',
        type: 'custom' as const,
        source: 'manual' as const,
        body: 'body',
      })
      .returning();
    await insert({ skillId: doomedSkill!.id, path: 'docs/cascade-skill.md' });

    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, doomedSkill!.id));

    const left = await pg.handle.db
      .select({ id: t.contextAttachments.id })
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.skillId, doomedSkill!.id));
    expect(left).toHaveLength(0);
  });

  it('deleting the repo deletes attachments discovered in it', async () => {
    const [doomedRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'doomed', fullName: 'acme/doomed' })
      .returning();
    await insert({ agentId, repoId: doomedRepo!.id, path: 'docs/cascade-repo.md' });

    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, doomedRepo!.id));

    const left = await pg.handle.db
      .select({ id: t.contextAttachments.id })
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.repoId, doomedRepo!.id));
    expect(left).toHaveLength(0);
  });
});
