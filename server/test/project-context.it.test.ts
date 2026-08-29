import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { ContextDocList, Projection, AttachmentRow } from '../src/modules/project-context/contract.js';
import { PROJECT_CONTEXT_TOKEN_BUDGET } from '../src/modules/project-context/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * One character = one token. Every budget assertion below is then arithmetic a
 * reader can check by eye, instead of depending on what `cl100k_base` happens to
 * do to a fixture. The real tokenizer is exercised in the unit tests.
 */
const tokenizer = { count: (text: string) => text.length };

const SMALL = '# A\n\nsmall doc.\n';

d('L05 project-context routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clone: string;
  let base: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;

    base = await realpath(await mkdtemp(join(tmpdir(), 'ctx-it-')));
    clone = join(base, 'clone');
    await mkdir(join(clone, 'docs'), { recursive: true });
    await mkdir(join(clone, 'server', 'docs'), { recursive: true });
    await mkdir(join(clone, '.devdigest', 'specs'), { recursive: true });
    await mkdir(join(clone, 'src'), { recursive: true });

    await writeFile(join(clone, 'docs', 'a.md'), SMALL);
    await writeFile(join(clone, 'server', 'docs', 'b.md'), '# B\n\nnon-leading segment.\n');
    await writeFile(join(clone, '.devdigest', 'specs', 'prd.md'), '# PRD\n\nprefix predicate.\n');
    // Committable negatives (the `node_modules/` one lives in the unit test).
    await writeFile(join(clone, 'README.md'), '# readme');
    await writeFile(join(clone, 'src', 'notes.md'), '# notes');
    // AC-6 — over the 64 KB per-document cap.
    await writeFile(join(clone, 'docs', 'huge.md'), 'H'.repeat(64 * 1024 + 10));
  });

  afterAll(async () => {
    if (base) await rm(base, { recursive: true, force: true });
    await pg?.stop();
  });

  const makeApp = () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { tokenizer },
    });

  let repoSeq = 0;
  async function makeRepo(clonePath: string | null, ws = workspaceId) {
    const name = `ctx-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  async function makeAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
      })
    ).json() as { id: string };
  }

  async function makeSkill(name: string, enabled = true) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'd',
        type: 'convention',
        source: 'manual',
        body: 'body',
        enabled,
      })
      .returning();
    return skill!;
  }

  const attach = (
    app: Awaited<ReturnType<typeof buildApp>>,
    payload: Record<string, unknown>,
  ) => app.inject({ method: 'POST', url: '/context/attachments', payload });

  // ------------------------------------------------------------------ listing

  it('AC-1 — lists discovered documents with path, size and modified time', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);

    // Parsed against the module contract, which is what keeps the client's own
    // copy of these shapes honest (no route declares a `response:` schema).
    const body = ContextDocList.parse(res.json());
    const paths = body.files.map((f) => f.path);

    expect(paths).toContain('docs/a.md');
    expect(paths).toContain('server/docs/b.md');
    expect(paths).toContain('.devdigest/specs/prd.md');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('src/notes.md');
    expect(body.reason).toBeNull();
    expect(body.capped).toBe(false);

    const a = body.files.find((f) => f.path === 'docs/a.md')!;
    expect(a.size).toBe(SMALL.length);
    expect(a.updated_at).toBeTruthy();
    expect(a.tokens_estimate).toBe(SMALL.length);

    await app.close();
  });

  it('AC-2 — a null clone_path gives an empty list with `not_cloned`, not a 500', async () => {
    const app = await makeApp();
    const repo = await makeRepo(null);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = ContextDocList.parse(res.json());
    expect(body.files).toEqual([]);
    expect(body.reason).toBe('not_cloned');

    await app.close();
  });

  it('F3 — a clone_path pointing at a deleted directory gives `clone_missing`, distinct and not a 500', async () => {
    const app = await makeApp();
    const repo = await makeRepo(join(base, 'deleted-clone'));

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = ContextDocList.parse(res.json());
    expect(body.files).toEqual([]);
    // The distinction is the whole point: a repo that was never set up and one
    // whose clone a `rm -rf` removed need different copy and different advice.
    expect(body.reason).toBe('clone_missing');
    expect(body.reason).not.toBe('not_cloned');

    await app.close();
  });

  it('AC-13 — another workspace`s repo is 404, never 403', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${repoSeq}` })
      .returning();
    const foreign = await makeRepo(clone, otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/repos/${foreign.id}/context` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');

    await app.close();
  });

  // --------------------------------------------------------------- attachment

  it('AC-9 — attach, re-fetch with order, detach', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'Attacher');

    const created = await attach(app, {
      path: 'docs/a.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: agent.id,
    });
    expect(created.statusCode).toBe(201);
    const row = AttachmentRow.parse(created.json());
    expect(row).toMatchObject({ path: 'docs/a.md', target_kind: 'agent', target_id: agent.id });
    expect(row.order).toBe(0);

    const listed = await app.inject({
      method: 'GET',
      url: `/context/attachments?target_kind=agent&target_id=${agent.id}`,
    });
    expect(listed.json()).toHaveLength(1);

    // Reordering is per row, so two tabs moving different documents do not
    // clobber each other (§6 Concurrency).
    const moved = await app.inject({
      method: 'PATCH',
      url: `/context/attachments/${row.id}`,
      payload: { order: 5 },
    });
    expect(AttachmentRow.parse(moved.json()).order).toBe(5);

    const gone = await app.inject({ method: 'DELETE', url: `/context/attachments/${row.id}` });
    expect(gone.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/context/attachments?target_kind=agent&target_id=${agent.id}`,
    });
    expect(after.json()).toEqual([]);

    await app.close();
  });

  it('AC-5 — traversal, absolute and null-byte paths are refused with the 422 envelope and never opened', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'Traversal');

    for (const path of ['../../../etc/passwd', '/etc/passwd', 'docs/a\u0000.md', 'C:\\win.ini']) {
      const res = await attach(app, {
        path,
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }

    await app.close();
  });

  it('AC-6 — an over-cap document is LISTED and marked, and cannot be attached', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'OverCap');

    const list = ContextDocList.parse(
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json(),
    );
    const huge = list.files.find((f) => f.path === 'docs/huge.md');
    expect(huge).toBeDefined();
    expect(huge!.over_cap).toBe(true);
    // Not measured — a number nobody may act on is not worth a 64 KB read.
    expect(huge!.tokens_estimate).toBeUndefined();

    const res = await attach(app, {
      path: 'docs/huge.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: agent.id,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    await app.close();
  });

  it('a duplicate attach is a clean 409, not a raw unique-violation 500 (F1 backstop)', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'Dupe');
    const payload = {
      path: 'docs/a.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: agent.id,
    };

    expect((await attach(app, payload)).statusCode).toBe(201);
    const second = await attach(app, payload);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('already_attached');

    await app.close();
  });

  it('AC-13 — another workspace`s attachment cannot be detached (404)', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-att-${repoSeq}` })
      .returning();
    const foreignRepo = await makeRepo(clone, otherWs!.id);
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();
    const [foreignAtt] = await pg.handle.db
      .insert(t.contextAttachments)
      .values({
        workspaceId: otherWs!.id,
        repoId: foreignRepo.id,
        agentId: foreignAgent!.id,
        path: 'docs/a.md',
        order: 0,
      })
      .returning();

    const res = await app.inject({
      method: 'DELETE',
      url: `/context/attachments/${foreignAtt!.id}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');

    // ...and it is still there.
    const [still] = await pg.handle.db
      .select()
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.id, foreignAtt!.id));
    expect(still).toBeDefined();

    await app.close();
  });

  it('AC-16 (server half) — a document attached to two agents reports used_by_count 2', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const a1 = await makeAgent(app, 'Counter A');
    const a2 = await makeAgent(app, 'Counter B');
    for (const agent of [a1, a2]) {
      await attach(app, {
        path: 'docs/a.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
    }

    const list = ContextDocList.parse(
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json(),
    );
    expect(list.files.find((f) => f.path === 'docs/a.md')!.used_by_count).toBe(2);
    // Absent, not 0, for a document nothing uses — §10 says the consumer shows
    // "—", which a 0 would silently defeat.
    expect(list.files.find((f) => f.path === 'server/docs/b.md')!.used_by_count).toBeUndefined();

    await app.close();
  });

  // --------------------------------------------------------------- projection

  it('AC-17 (server half) — the projection covers direct + inherited documents, wrappers and the heading', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'Projected');
    const skill = await makeSkill(`proj-skill-${repoSeq}`);
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });

    for (const path of ['docs/a.md', 'server/docs/b.md']) {
      await attach(app, { path, repo_id: repo.id, target_kind: 'agent', target_id: agent.id });
    }
    await attach(app, {
      path: '.devdigest/specs/prd.md',
      repo_id: repo.id,
      target_kind: 'skill',
      target_id: skill.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context/projection`,
    });
    expect(res.statusCode).toBe(200);
    const projection = Projection.parse(res.json());

    expect(projection.agent_id).toBe(agent.id);
    expect(projection.budget_tokens).toBe(PROJECT_CONTEXT_TOKEN_BUDGET);
    // Direct first, then inherited — the injection order a run uses.
    expect(projection.entries.map((e) => e.path)).toEqual([
      'docs/a.md',
      'server/docs/b.md',
      '.devdigest/specs/prd.md',
    ]);
    expect(projection.entries.map((e) => e.origin)).toEqual(['agent', 'agent', 'skill']);
    expect(projection.entries[2]!.via_skill_id).toBe(skill.id);
    expect(projection.entries.every((e) => e.outcome === 'injected')).toBe(true);

    // Strictly MORE than the sum of the raw documents: the wrappers and the
    // section heading are real cost, and a page that summed rows would
    // understate it (D-9).
    const rawChars = SMALL.length + '# B\n\nnon-leading segment.\n'.length +
      '# PRD\n\nprefix predicate.\n'.length;
    expect(projection.projected_tokens).toBeGreaterThan(rawChars);
    // ...and it is not the sum of the entry estimates either.
    const entrySum = projection.entries.reduce((n, e) => n + (e.tokens_estimate ?? 0), 0);
    expect(projection.projected_tokens).not.toBe(entrySum);

    await app.close();
  });

  it('AC-30 (server half) — a disabled linked skill contributes nothing to the projection', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'DisabledSkills');
    const skill = await makeSkill(`disabled-skill-${repoSeq}`);
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });
    await attach(app, {
      path: 'docs/a.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: agent.id,
    });
    await attach(app, {
      path: 'server/docs/b.md',
      repo_id: repo.id,
      target_kind: 'skill',
      target_id: skill.id,
    });

    const enabled = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection` })).json(),
    );
    expect(enabled.entries.map((e) => e.path)).toEqual(['docs/a.md', 'server/docs/b.md']);

    await pg.handle.db.update(t.skills).set({ enabled: false }).where(eq(t.skills.id, skill.id));

    const disabled = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection` })).json(),
    );
    // The filter is in SQL (`skills.enabled = true`), so the inherited document
    // is not merely marked — it never enters the projection at all.
    expect(disabled.entries.map((e) => e.path)).toEqual(['docs/a.md']);
    expect(disabled.projected_tokens).toBeLessThan(enabled.projected_tokens);

    await app.close();
  });

  it('AC-27 — over budget, the would-be-dropped documents are marked BEFORE any run', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'OverBudget');

    // Two documents that each nearly fill the 8 000-token section budget under
    // the one-char-one-token counter.
    await mkdir(join(clone, 'docs', 'big'), { recursive: true });
    await writeFile(join(clone, 'docs', 'big', 'one.md'), 'A'.repeat(5000));
    await writeFile(join(clone, 'docs', 'big', 'two.md'), 'B'.repeat(5000));

    for (const path of ['docs/big/one.md', 'docs/big/two.md']) {
      await attach(app, { path, repo_id: repo.id, target_kind: 'agent', target_id: agent.id });
    }

    const projection = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection` })).json(),
    );
    expect(projection.entries.map((e) => e.outcome)).toEqual(['injected', 'dropped_budget']);
    expect(projection.projected_tokens).toBeLessThanOrEqual(PROJECT_CONTEXT_TOKEN_BUDGET);

    await rm(join(clone, 'docs', 'big'), { recursive: true, force: true });
    await app.close();
  });

  it('AC-31 — the same document is dropped for the over-budget agent and injected for the other', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agentA = await makeAgent(app, 'Roomy');
    const agentB = await makeAgent(app, 'Crowded');
    const skill = await makeSkill(`shared-skill-${repoSeq}`);
    await app.inject({
      method: 'POST',
      url: `/agents/${agentB.id}/skills`,
      payload: { skill_id: skill.id },
    });

    await mkdir(join(clone, 'docs', 'shared'), { recursive: true });
    await writeFile(join(clone, 'docs', 'shared', 'shared.md'), 'S'.repeat(3000));
    await writeFile(join(clone, 'docs', 'shared', 'filler.md'), 'F'.repeat(7000));

    // A: the shared document, directly, with room to spare.
    await attach(app, {
      path: 'docs/shared/shared.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: agentA.id,
    });
    // B: a big direct document first, then the shared one inherited via a skill.
    await attach(app, {
      path: 'docs/shared/filler.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: agentB.id,
    });
    await attach(app, {
      path: 'docs/shared/shared.md',
      repo_id: repo.id,
      target_kind: 'skill',
      target_id: skill.id,
    });

    const forA = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentA.id}/context/projection` })).json(),
    );
    const forB = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentB.id}/context/projection` })).json(),
    );

    const inA = forA.entries.find((e) => e.path === 'docs/shared/shared.md')!;
    const inB = forB.entries.find((e) => e.path === 'docs/shared/shared.md')!;
    // Per agent, not per page: survival depends on the agent's own attachments
    // and enabled skills, so the same document legitimately differs.
    expect(inA.outcome).toBe('injected');
    expect(inB.outcome).toBe('dropped_budget');
    expect(inB.origin).toBe('skill');

    await rm(join(clone, 'docs', 'shared'), { recursive: true, force: true });
    await app.close();
  });

  it('a projection against a missing clone skips every document rather than throwing (F3)', async () => {
    const app = await makeApp();
    const repo = await makeRepo(join(base, 'also-deleted'));
    const agent = await makeAgent(app, 'MissingClone');
    // Attach directly: the route's own over-cap probe tolerates a missing clone,
    // but this asserts the projection path, which is the shared one.
    await pg.handle.db.insert(t.contextAttachments).values({
      workspaceId,
      repoId: repo.id,
      agentId: agent.id,
      path: 'docs/a.md',
      order: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context/projection`,
    });
    expect(res.statusCode).toBe(200);
    const projection = Projection.parse(res.json());
    expect(projection.entries.map((e) => e.outcome)).toEqual(['skipped']);
    expect(projection.projected_tokens).toBe(0);

    await app.close();
  });
});
