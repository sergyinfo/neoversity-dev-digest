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
import {
  MAX_ATTACHMENTS_PER_TARGET,
  MAX_DOCS_PER_RESOLUTION,
  PROJECT_CONTEXT_TOKEN_BUDGET,
} from '../src/modules/project-context/constants.js';

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
    await mkdir(join(clone, '.git'), { recursive: true });

    await writeFile(join(clone, 'docs', 'a.md'), SMALL);
    await writeFile(join(clone, 'server', 'docs', 'b.md'), '# B\n\nnon-leading segment.\n');
    await writeFile(join(clone, '.devdigest', 'specs', 'prd.md'), '# PRD\n\nprefix predicate.\n');
    // Committable negatives (the `node_modules/` one lives in the unit test).
    await writeFile(join(clone, 'README.md'), '# readme');
    await writeFile(join(clone, 'src', 'notes.md'), '# notes');
    // AC-6 — over the 64 KB per-document cap.
    await writeFile(join(clone, 'docs', 'huge.md'), 'H'.repeat(64 * 1024 + 10));
    // F1 — the real payload. `git clone` writes the tokenised remote URL into
    // `.git/config` verbatim and nothing rewrites it afterwards, so a readable
    // `.git/config` is a readable GitHub PAT.
    await writeFile(
      join(clone, '.git', 'config'),
      '[remote "origin"]\n\turl = https://x-access-token:ghp_ITSECRET@github.com/a/b.git\n',
    );
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

  /**
   * AC-5, and the half `routes-smoke.test.ts` cannot cover (fix-brief F7).
   *
   * A GENUINE traversal path is not refused by the schema — `'../../etc/passwd'`
   * satisfies `z.string().min(1).max(...)` perfectly well. It is refused one
   * layer in, by `attach()`'s `isSafeRelPath` gate, which needs a live handler
   * and therefore a database. The smoke test's version used to send `path: ''`
   * under a comment claiming a traversal path, so the case it named was never
   * exercised anywhere.
   *
   * The `error.message` assertion is what names the layer: the schema branch of
   * `app.ts` always says "Request validation failed", so a message of "Invalid
   * document path" can only have come from the service. Both produce 422
   * `validation_error`, which is why the status and code alone cannot tell them
   * apart — and why asserting only those would leave a check that passes if the
   * handler gate is deleted.
   */
  it('AC-5 — traversal, absolute and control-byte paths are refused by the handler gate, never opened, never stored', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'Traversal');

    for (const path of [
      '../../../etc/passwd',
      'docs/../../etc/passwd',
      '/etc/passwd',
      'docs/a\u0000.md',
      'docs/a\nFAKE.md',
      'C:\\win.ini',
    ]) {
      const res = await attach(app, {
        path,
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
      // The SERVICE refused it, not the schema.
      expect(res.json().error.message).toBe('Invalid document path');
      expect(res.json().error.details).toEqual({ path });
    }

    // Nothing was written for any of them.
    const stored = await pg.handle.db
      .select()
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.agentId, agent.id));
    expect(stored).toEqual([]);

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

  /**
   * Fix-brief F8 — `used_by_count` for a path containing a SPACE.
   *
   * F8 was reported as a bug and is NOT one: `usageCounts` keys its
   * distinct-agent set on `` `${path}\u0000${agentId}` `` and splits on the NUL,
   * not on a space. The separator was written as a LITERAL 0x00 byte, which
   * makes the whole file `data` to `file(1)` and binary to `grep(1)` — every
   * match in `repository.ts` was silently suppressed — and renders as
   * whitespace in a viewer, which is how it came to be read as a space. The
   * byte is now an escape; the logic is unchanged.
   *
   * The test stays, because nothing asserted this before and the behaviour is
   * one character away from the reported bug: split on a space instead and
   * `docs/my notes.md` buckets under `docs/my`, `used_by_count` goes absent,
   * and the row renders "—" for a document that IS in use — the
   * absent-is-not-zero distinction AC-16 exists to protect, inverted. The
   * second document shares everything before its first space, so a space split
   * would also SUM the two into one bucket; hence two distinct counts asserted,
   * not one.
   *
   * A dedicated clone, so the shared fixture's listing stays exactly as the
   * other cases describe it.
   */
  it('F8 — a document whose path contains a space reports its own used_by_count', async () => {
    const app = await makeApp();
    const spaceClone = join(base, 'clone-space');
    await mkdir(join(spaceClone, 'docs'), { recursive: true });
    await writeFile(join(spaceClone, 'docs', 'my notes.md'), SMALL);
    await writeFile(join(spaceClone, 'docs', 'my other.md'), SMALL);
    const repo = await makeRepo(spaceClone);

    const a1 = await makeAgent(app, 'Spacey A');
    const a2 = await makeAgent(app, 'Spacey B');
    for (const agent of [a1, a2]) {
      const res = await attach(app, {
        path: 'docs/my notes.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      expect(res.statusCode).toBe(201);
    }
    // Shares the prefix before the first space with the document above.
    expect(
      (
        await attach(app, {
          path: 'docs/my other.md',
          repo_id: repo.id,
          target_kind: 'agent',
          target_id: a1.id,
        })
      ).statusCode,
    ).toBe(201);

    const list = ContextDocList.parse(
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json(),
    );
    expect(list.files.find((f) => f.path === 'docs/my notes.md')!.used_by_count).toBe(2);
    expect(list.files.find((f) => f.path === 'docs/my other.md')!.used_by_count).toBe(1);

    await app.close();
  });

  /**
   * Fix-brief F1 — the allow-list is a security control, so it is enforced at
   * every gate that feeds the model, not only in the walk.
   *
   * Both halves matter and they are separate defects. Refusing at attach stops
   * new attachments; refusing at read is what makes an attachment STORED BEFORE
   * the fix — or inserted by any other writer — harmless.
   */
  describe('F1 — a non-allow-listed path is refused at attach AND at read', () => {
    const REFUSED = ['.git/config', '.env', 'README.md', 'src/notes.md', 'node_modules/evil/x.md'];

    it('attach refuses each one with the 422 envelope, and stores nothing', async () => {
      const app = await makeApp();
      const repo = await makeRepo(clone);
      const agent = await makeAgent(app, 'AllowListAttach');

      for (const path of REFUSED) {
        const res = await attach(app, {
          path,
          repo_id: repo.id,
          target_kind: 'agent',
          target_id: agent.id,
        });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe('validation_error');
        // §7 — the refusal names the path and a cause, never file content.
        expect(res.payload).not.toContain('ITSECRET');
      }

      const listed = await app.inject({
        method: 'GET',
        url: `/context/attachments?target_kind=agent&target_id=${agent.id}`,
      });
      expect(listed.json()).toEqual([]);

      await app.close();
    });

    it('a row stored BEFORE the fix is still not readable — the projection skips it', async () => {
      const app = await makeApp();
      const repo = await makeRepo(clone);
      const agent = await makeAgent(app, 'AllowListRead');

      // Straight into the table, bypassing `attach` entirely: this is exactly
      // the state a pre-fix attach left behind, and the state the read gate
      // must be independently able to refuse.
      for (const [i, path] of REFUSED.entries()) {
        await pg.handle.db.insert(t.contextAttachments).values({
          workspaceId,
          repoId: repo.id,
          agentId: agent.id,
          path,
          order: i,
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
      });
      expect(res.statusCode).toBe(200);
      const projection = Projection.parse(res.json());

      // Every one refused, nothing injected, and no section at all.
      expect(projection.entries.map((e) => e.path).sort()).toEqual([...REFUSED].sort());
      expect(projection.entries.every((e) => e.outcome === 'skipped')).toBe(true);
      expect(projection.projected_tokens).toBe(0);
      // The assertion that actually matters: the PAT is not in the response.
      expect(res.payload).not.toContain('ITSECRET');
      expect(res.payload).not.toContain('ghp_');

      await app.close();
    });

    it('an allow-listed document in the same repo is unaffected', async () => {
      const app = await makeApp();
      const repo = await makeRepo(clone);
      const agent = await makeAgent(app, 'AllowListControl');

      const ok = await attach(app, {
        path: 'docs/a.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      expect(ok.statusCode).toBe(201);

      const projection = Projection.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
          })
        ).json(),
      );
      expect(projection.entries.map((e) => e.outcome)).toEqual(['injected']);

      await app.close();
    });
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
      url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
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
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}` })).json(),
    );
    expect(enabled.entries.map((e) => e.path)).toEqual(['docs/a.md', 'server/docs/b.md']);

    await pg.handle.db.update(t.skills).set({ enabled: false }).where(eq(t.skills.id, skill.id));

    const disabled = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}` })).json(),
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
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}` })).json(),
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
      (await app.inject({ method: 'GET', url: `/agents/${agentA.id}/context/projection?repo_id=${repo.id}` })).json(),
    );
    const forB = Projection.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentB.id}/context/projection?repo_id=${repo.id}` })).json(),
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

  /**
   * Fix-brief F2 — the projection must know which repository it is FOR.
   *
   * Before the fix `projectForAgent` passed each attachment its own repo id as
   * "the repo under review", so `readAttachment`'s cross-repo guard evaluated
   * `x !== x` — permanently false. A multi-repo agent's page therefore promised
   * to inject documents a run would skip, and `ProjectionOutcome.skipped`
   * could never be emitted for its documented "wrong repo" cause.
   */
  describe('F2 — the projection is per repository', () => {
    it('a document attached against ANOTHER repo is skipped, not injected', async () => {
      const app = await makeApp();
      const repoA = await makeRepo(clone);
      const repoB = await makeRepo(clone);
      const agent = await makeAgent(app, 'MultiRepo');

      // The SAME clone behind both repo rows, so the file is genuinely readable
      // for either — the skip can only come from the repo comparison, never
      // from the document being missing.
      await attach(app, {
        path: 'docs/a.md',
        repo_id: repoA.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      await attach(app, {
        path: 'server/docs/b.md',
        repo_id: repoB.id,
        target_kind: 'agent',
        target_id: agent.id,
      });

      const forA = Projection.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/agents/${agent.id}/context/projection?repo_id=${repoA.id}`,
          })
        ).json(),
      );
      expect(forA.repo_id).toBe(repoA.id);
      expect(forA.entries.map((e) => [e.path, e.outcome])).toEqual([
        ['docs/a.md', 'injected'],
        ['server/docs/b.md', 'skipped'],
      ]);

      // ...and the mirror image for the other repo, so this is a real
      // per-repo computation rather than "the second one is always skipped".
      const forB = Projection.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/agents/${agent.id}/context/projection?repo_id=${repoB.id}`,
          })
        ).json(),
      );
      expect(forB.entries.map((e) => [e.path, e.outcome])).toEqual([
        ['docs/a.md', 'skipped'],
        ['server/docs/b.md', 'injected'],
      ]);

      // The two totals differ, because different documents survive.
      expect(forA.projected_tokens).not.toBe(forB.projected_tokens);
      // Every entry names its own repository (F3's render-key half).
      expect(forA.entries.map((e) => e.repo_id)).toEqual([repoA.id, repoB.id]);

      await app.close();
    });

    it('repo_id is required — a projection with no repository is a 422, not a guess', async () => {
      const app = await makeApp();
      const agent = await makeAgent(app, 'NoRepoProjection');

      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context/projection`,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');

      await app.close();
    });

    it('a repo from another workspace is a 404, never a 403 or an empty projection', async () => {
      const app = await makeApp();
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-proj-${repoSeq}` })
        .returning();
      const foreign = await makeRepo(clone, otherWs!.id);
      const agent = await makeAgent(app, 'ForeignRepoProjection');

      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context/projection?repo_id=${foreign.id}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');

      await app.close();
    });
  });

  /**
   * Fix-brief F3 — the two partial unique indexes are PER TARGET KIND, so the
   * same document can legitimately be attached directly to an agent AND to a
   * skill it links. `resolveForAgent` concatenated both lists with no dedupe, so
   * the run rendered it twice as `spec-0` and `spec-1` with byte-identical
   * bodies and paid the budget twice — while `usageCounts` deduped the same
   * configuration for display, so the page said 1 and the run sent 2.
   */
  it('F3 — a document reachable directly AND through a skill appears exactly once', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'DedupeAgent');
    const skill = await makeSkill(`dedupe-skill-${repoSeq}`);
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });

    // The same path on both targets — allowed by the schema, and the exact
    // configuration that produced the duplicate.
    for (const target of [
      { target_kind: 'agent', target_id: agent.id },
      { target_kind: 'skill', target_id: skill.id },
    ]) {
      const res = await attach(app, { path: 'docs/a.md', repo_id: repo.id, ...target });
      expect(res.statusCode).toBe(201);
    }

    const projection = Projection.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
        })
      ).json(),
    );

    expect(projection.entries).toHaveLength(1);
    // The DIRECT attachment wins: it is the user's explicit choice for this
    // agent, and reporting it as inherited would mean detaching the skill did
    // not remove it.
    expect(projection.entries[0]).toMatchObject({
      path: 'docs/a.md',
      origin: 'agent',
      outcome: 'injected',
    });
    expect(projection.entries[0]!.via_skill_id).toBeFalsy();

    // The budget is charged once. Compared against an agent holding the single
    // document directly and nothing else — the same document, one copy.
    const solo = await makeAgent(app, 'SoloAgent');
    await attach(app, {
      path: 'docs/a.md',
      repo_id: repo.id,
      target_kind: 'agent',
      target_id: solo.id,
    });
    const soloProjection = Projection.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/agents/${solo.id}/context/projection?repo_id=${repo.id}`,
        })
      ).json(),
    );
    expect(projection.projected_tokens).toBe(soloProjection.projected_tokens);

    // ...and the page agrees: `usageCounts` counts DISTINCT agents, so this
    // document is used by two agents, not three.
    const list = ContextDocList.parse(
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json(),
    );
    expect(list.files.find((f) => f.path === 'docs/a.md')!.used_by_count).toBe(2);

    await app.close();
  });

  /**
   * Fix-brief F5 — the per-target cap of 20 does NOT bound a resolution, because
   * an agent resolves its own 20 plus 20 per enabled linked skill and `linkSkill`
   * is an unbounded upsert. `MAX_DOCS_PER_RESOLUTION` is the bound that does not
   * grow with the skill count.
   */
  it('F5 — the number of documents read is bounded by MAX_DOCS_PER_RESOLUTION, not by the skill count', async () => {
    const app = await makeApp();
    const repo = await makeRepo(clone);
    const agent = await makeAgent(app, 'ManySkillsAgent');

    // 20 direct + 3 skills × 20 inherited = 80 attachments, all pointing at
    // REAL, readable, allow-listed, well-under-budget documents. If the bound
    // were not applied every one of them would be read and injected.
    const perTarget = MAX_ATTACHMENTS_PER_TARGET;
    await mkdir(join(clone, 'docs', 'many'), { recursive: true });
    const rows: Array<Record<string, unknown>> = [];
    let n = 0;
    const addDocs = async (target: { agentId?: string; skillId?: string }) => {
      for (let i = 0; i < perTarget; i++) {
        const rel = `docs/many/d-${String(n).padStart(3, '0')}.md`;
        await writeFile(join(clone, rel), `# ${n}\n`);
        rows.push({ workspaceId, repoId: repo.id, path: rel, order: i, ...target });
        n++;
      }
    };
    await addDocs({ agentId: agent.id });
    for (let sk = 0; sk < 3; sk++) {
      const skill = await makeSkill(`bound-skill-${repoSeq}-${sk}`);
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: skill.id },
      });
      await addDocs({ skillId: skill.id });
    }
    // Inserted directly: this test is about RESOLUTION, and 80 HTTP attaches
    // would just be 80 more clone reads that prove nothing.
    await pg.handle.db.insert(t.contextAttachments).values(rows as never);
    expect(rows).toHaveLength(perTarget * 4);

    const projection = Projection.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
        })
      ).json(),
    );

    // Every attachment is still LISTED — a silently shortened list is the
    // invisible failure this feature exists to remove.
    expect(projection.entries).toHaveLength(perTarget * 4);

    const considered = projection.entries.filter((e) => e.outcome !== 'skipped');
    const overLimit = projection.entries.filter(
      (e) => e.outcome === 'skipped',
    );
    expect(considered).toHaveLength(MAX_DOCS_PER_RESOLUTION);
    expect(overLimit).toHaveLength(perTarget * 4 - MAX_DOCS_PER_RESOLUTION);

    // The cut falls at the TAIL of injection order — the agent's own 20 are all
    // considered, and what is dropped is the furthest-inherited.
    expect(projection.entries.slice(0, MAX_DOCS_PER_RESOLUTION).every((e) => e.outcome !== 'skipped')).toBe(true);

    // The bound does not grow with the skill count: a fourth skill adds 20 more
    // attachments and not one more read.
    const extra = await makeSkill(`bound-skill-${repoSeq}-extra`);
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: extra.id },
    });
    const extraRows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < perTarget; i++) {
      const rel = `docs/many/d-${String(n).padStart(3, '0')}.md`;
      await writeFile(join(clone, rel), `# ${n}\n`);
      extraRows.push({ workspaceId, repoId: repo.id, path: rel, order: i, skillId: extra.id });
      n++;
    }
    await pg.handle.db.insert(t.contextAttachments).values(extraRows as never);

    const after = Projection.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
        })
      ).json(),
    );
    expect(after.entries).toHaveLength(perTarget * 5);
    expect(after.entries.filter((e) => e.outcome !== 'skipped')).toHaveLength(
      MAX_DOCS_PER_RESOLUTION,
    );
    // ...and the same documents survive, so the added skill changed nothing
    // about what the run would send.
    expect(after.projected_tokens).toBe(projection.projected_tokens);

    await rm(join(clone, 'docs', 'many'), { recursive: true, force: true });
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
      url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
    });
    expect(res.statusCode).toBe(200);
    const projection = Projection.parse(res.json());
    expect(projection.entries.map((e) => e.outcome)).toEqual(['skipped']);
    expect(projection.projected_tokens).toBe(0);

    await app.close();
  });
});
