import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns, waitForTrace } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Projection } from '../src/modules/project-context/contract.js';
import { PROJECT_CONTEXT_TOKEN_BUDGET } from '../src/modules/project-context/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      explanation: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      explanation: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null = null,
) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = await waitForTrace<{
      config: { model: string };
      stats: { grounding: string };
      log: unknown[];
    }>(app, runId);
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('L02: linked skills reach the model prompt and the run trace; unlinked runs are unchanged', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const SKILL_BODY = '## breaking-change\nFlag any removed or renamed public field.';

    // Build the app around a mock we keep a handle on, so we can inspect what was
    // actually sent to the model rather than trusting the trace alone.
    const mock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: mock },
      },
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Contract', provider: 'openai', model: 'gpt-4.1', system_prompt: 'base' },
      })
    ).json();

    // ---- baseline: no skills linked ----------------------------------------
    const before = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const beforeTrace = await waitForTrace<{ prompt_assembly: { skills: string | null } }>(
      app,
      before.runs[0].run_id,
    );
    expect(beforeTrace.prompt_assembly.skills).toBeNull();
    expect(JSON.stringify(mock.calls)).not.toContain('breaking-change');

    // ---- link a skill, run again -------------------------------------------
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'breaking-change',
        description: 'Flags removed or renamed public contract fields.',
        type: 'convention',
        source: 'manual',
        body: SKILL_BODY,
      })
      .returning();

    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill!.id },
    });
    expect(linked.statusCode).toBeLessThan(300);

    mock.calls.length = 0;
    const after = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    // The body reached the MODEL — this is the assertion the A/B experiment rests
    // on. Without it a "skills make no difference" result would be unfalsifiable.
    expect(JSON.stringify(mock.calls)).toContain('breaking-change');

    // ...and it is visible in the trace, which is what the demo shows.
    const afterTrace = await waitForTrace<{ prompt_assembly: { skills: string | null } }>(
      app,
      after.runs[0].run_id,
    );
    expect(afterTrace.prompt_assembly.skills).toContain('breaking-change');

    // ---- a disabled skill must not reach the model --------------------------
    await pg.handle.db.update(t.skills).set({ enabled: false }).where(eq(t.skills.id, skill!.id));
    mock.calls.length = 0;
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
    expect(JSON.stringify(mock.calls)).not.toContain('breaking-change');

    await app.close();
  });


  /**
   * L05 — Project Context reaches the model, the trace and the run log.
   *
   * Two assertion mechanics are load-bearing here and both cost a debugging
   * cycle if got wrong:
   *
   *  - `JSON.stringify(mock.calls)` ESCAPES quotes, so
   *    `.toContain('<untrusted source="spec-0">')` can never match — it is
   *    stored as `source=\"spec-0\"` and the failure reads like a missing
   *    prompt section (`server/INSIGHTS.md`, 2026-08-28). Delimiter assertions
   *    therefore go against `trace.prompt_assembly.user`.
   *  - `waitForTrace`, never `waitForPrRuns` alone, before touching
   *    `prompt_assembly` (`server/INSIGHTS.md`, 2026-08-17).
   */
  describe('L05 project context', () => {
    const DOC_A = '# Pricing spec\n\nCharges are cost-plus-14pct. Never round up.\n';
    const DOC_B = '# Retention spec\n\nDeletion is soft for 30 days.\n';

    let base: string;
    let clone: string;

    beforeAll(async () => {
      base = await realpath(await mkdtemp(join(tmpdir(), 'ctx-run-')));
      clone = join(base, 'clone');
      await mkdir(join(clone, 'docs'), { recursive: true });
      await writeFile(join(clone, 'docs', 'a.md'), DOC_A);
      await writeFile(join(clone, 'docs', 'b.md'), DOC_B);
    });
    afterAll(async () => {
      if (base) await rm(base, { recursive: true, force: true });
    });

    type Trace = {
      prompt_assembly: { specs: string | null; user: string };
      specs_read: string[];
      log: Array<{ msg: string }>;
    };

    function appWithMock(mock: MockLLMProvider) {
      return buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: DIFF }),
          llm: { openai: mock },
        },
      });
    }

    const newAgent = async (app: Awaited<ReturnType<typeof buildApp>>, name: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'base' },
        })
      ).json() as { id: string };

    const attach = (
      app: Awaited<ReturnType<typeof buildApp>>,
      payload: Record<string, unknown>,
    ) => app.inject({ method: 'POST', url: '/context/attachments', payload });

    async function runAndTrace(
      app: Awaited<ReturnType<typeof buildApp>>,
      prId: string,
      agentId: string,
      expected: number,
    ): Promise<Trace> {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/pulls/${prId}/review`,
          payload: { agentId },
        })
      ).json();
      await waitForPrRuns(pg.handle.db, prId, { expected });
      return waitForTrace<Trace>(app, body.runs[0].run_id);
    }

    it('AC-18 / AC-19 — one attachment renders the section; removing it restores a byte-identical prompt', async () => {
      const mock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
      const app = await appWithMock(mock);
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'CtxAgent');

      // ---- AC-19 baseline: no attachments -----------------------------------
      const before = await runAndTrace(app, pr.id, agent.id, 1);
      expect(before.prompt_assembly.specs).toBeNull();
      expect(before.specs_read).toEqual([]);
      expect(before.prompt_assembly.user).not.toContain('## Project context');

      // ---- AC-18: attach one document ---------------------------------------
      const created = await attach(app, {
        path: 'docs/a.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      expect(created.statusCode).toBe(201);

      const after = await runAndTrace(app, pr.id, agent.id, 2);
      expect(after.prompt_assembly.specs).not.toBeNull();
      expect(after.prompt_assembly.user).toContain('## Project context');
      expect(after.prompt_assembly.user).toContain('<untrusted source="spec-0">');
      expect(after.prompt_assembly.user).toContain('cost-plus-14pct');
      expect(after.specs_read).toEqual(['docs/a.md']);
      // The text really reached the MODEL, not merely the trace.
      expect(JSON.stringify(mock.calls)).toContain('cost-plus-14pct');

      // ---- AC-19 proper: detach, and the prompt returns to the baseline ------
      await app.inject({
        method: 'DELETE',
        url: `/context/attachments/${created.json().id}`,
      });
      const restored = await runAndTrace(app, pr.id, agent.id, 3);
      // BYTE-identical, not merely "no section": this is the regression bar.
      expect(restored.prompt_assembly.user).toBe(before.prompt_assembly.user);
      expect(restored.prompt_assembly.specs).toBeNull();
      expect(restored.specs_read).toEqual([]);

      await app.close();
    });

    it('AC-11 / AC-12 — a skill-attached document reaches the agent only while the skill is enabled', async () => {
      const mock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
      const app = await appWithMock(mock);
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'InheritAgent');

      const [skill] = await pg.handle.db
        .insert(t.skills)
        .values({
          workspaceId,
          name: `ctx-skill-${repoSeq}`,
          description: 'd',
          type: 'convention',
          source: 'manual',
          body: 'skill body',
        })
        .returning();
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: skill!.id },
      });
      await attach(app, {
        path: 'docs/b.md',
        repo_id: repo.id,
        target_kind: 'skill',
        target_id: skill!.id,
      });

      const enabled = await runAndTrace(app, pr.id, agent.id, 1);
      expect(enabled.prompt_assembly.user).toContain('Deletion is soft for 30 days');
      expect(enabled.specs_read).toEqual(['docs/b.md']);

      // AC-12 — disabling the skill removes its document, and the run is
      // otherwise unaffected. The filter is in SQL, so no caller can forget it.
      await pg.handle.db.update(t.skills).set({ enabled: false }).where(eq(t.skills.id, skill!.id));
      mock.calls.length = 0;

      const disabled = await runAndTrace(app, pr.id, agent.id, 2);
      expect(disabled.prompt_assembly.specs).toBeNull();
      expect(disabled.specs_read).toEqual([]);
      expect(JSON.stringify(mock.calls)).not.toContain('Deletion is soft');
      // The review still happened.
      expect(disabled.prompt_assembly.user).toContain('## Diff to review');

      await app.close();
    });

    it('AC-10 — changing the attachment order changes the injection order', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'OrderedAgent');

      const first = (
        await attach(app, {
          path: 'docs/a.md',
          repo_id: repo.id,
          target_kind: 'agent',
          target_id: agent.id,
        })
      ).json();
      await attach(app, {
        path: 'docs/b.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });

      const before = await runAndTrace(app, pr.id, agent.id, 1);
      expect(before.specs_read).toEqual(['docs/a.md', 'docs/b.md']);
      expect(before.prompt_assembly.user.indexOf('cost-plus-14pct')).toBeLessThan(
        before.prompt_assembly.user.indexOf('Deletion is soft'),
      );

      // Move the first document to the end.
      await app.inject({
        method: 'PATCH',
        url: `/context/attachments/${first.id}`,
        payload: { order: 99 },
      });

      const after = await runAndTrace(app, pr.id, agent.id, 2);
      expect(after.specs_read).toEqual(['docs/b.md', 'docs/a.md']);
      expect(after.prompt_assembly.user.indexOf('Deletion is soft')).toBeLessThan(
        after.prompt_assembly.user.indexOf('cost-plus-14pct'),
      );

      await app.close();
    });

    it('AC-20 / AC-23 — a document deleted from the clone is skipped, recorded and logged; the run completes', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'DeletedDocAgent');

      // A document that exists at attach time and is gone by run time — the
      // TOCTOU the containment gate has to survive, arriving benignly.
      await writeFile(join(clone, 'docs', 'temp.md'), '# Temp\n\nabout to vanish.\n');
      await attach(app, {
        path: 'docs/temp.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      await attach(app, {
        path: 'docs/a.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      await rm(join(clone, 'docs', 'temp.md'), { force: true });

      const trace = await runAndTrace(app, pr.id, agent.id, 1);

      // The run completed normally and the surviving document is still injected.
      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
      expect(run!.status).toBe('done');
      expect(trace.prompt_assembly.user).toContain('cost-plus-14pct');

      // AC-23 — the trace names the missing document AND a reason.
      expect(trace.specs_read).toHaveLength(2);
      const missing = trace.specs_read.find((s) => s.startsWith('docs/temp.md'))!;
      expect(missing).toContain('docs/temp.md');
      expect(missing.length).toBeGreaterThan('docs/temp.md'.length);
      expect(trace.specs_read).toContain('docs/a.md');

      // ...and the run log has a line naming it, carrying no document text.
      const line = trace.log.find((l) => l.msg.includes('docs/temp.md'));
      expect(line).toBeDefined();
      expect(line!.msg).toContain('project context: skipped');
      expect(JSON.stringify(trace.log)).not.toContain('about to vanish');

      await app.close();
    });

    it('AC-21 — a cross-repo document is skipped, and no same-named file from the repo under review is read', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));

      // Two clones, each with `docs/a.md`, holding DIFFERENT text.
      const otherClone = join(base, 'other-clone');
      await mkdir(join(otherClone, 'docs'), { recursive: true });
      await writeFile(join(otherClone, 'docs', 'a.md'), '# Other repo\n\nSAME NAME DIFFERENT PROJECT\n');

      const other = await setupRepoAndPr(pg.handle.db, workspaceId, otherClone);
      const under = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'CrossRepoAgent');

      // Attached against the OTHER repo, then run against a PR in this one.
      await attach(app, {
        path: 'docs/a.md',
        repo_id: other.repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });

      const trace = await runAndTrace(app, under.pr.id, agent.id, 1);

      expect(trace.prompt_assembly.specs).toBeNull();
      // Neither project's text is in the prompt: not the other repo's (it is a
      // different repository) and NOT this repo's same-named file (silent
      // same-name resolution is exactly what D-6 forbids).
      expect(trace.prompt_assembly.user).not.toContain('SAME NAME DIFFERENT PROJECT');
      expect(trace.prompt_assembly.user).not.toContain('cost-plus-14pct');
      expect(trace.specs_read).toHaveLength(1);
      expect(trace.specs_read[0]).toContain('docs/a.md');
      expect(trace.specs_read[0]).toContain('different repository');

      await app.close();
    });

    it('AC-22 / AC-27 — over budget, whole documents are dropped from the end and each is recorded', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'BudgetAgent');

      // Two documents whose combined estimate exceeds the 8 000-token section
      // budget under the REAL tokenizer (~1 token per 4 chars for this text).
      await mkdir(join(clone, 'docs', 'budget'), { recursive: true });
      const filler = 'alpha beta gamma delta epsilon zeta eta theta iota kappa\n';
      await writeFile(join(clone, 'docs', 'budget', 'one.md'), filler.repeat(500));
      await writeFile(join(clone, 'docs', 'budget', 'two.md'), filler.repeat(500));

      for (const path of ['docs/budget/one.md', 'docs/budget/two.md']) {
        await attach(app, { path, repo_id: repo.id, target_kind: 'agent', target_id: agent.id });
      }

      // AC-27's first half: the page marks the drop BEFORE any run.
      const projection = Projection.parse(
        (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}` })).json(),
      );
      const markedDropped = projection.entries
        .filter((e) => e.outcome === 'dropped_budget')
        .map((e) => e.path);
      expect(markedDropped).toEqual(['docs/budget/two.md']);
      expect(projection.projected_tokens).toBeLessThanOrEqual(PROJECT_CONTEXT_TOKEN_BUDGET);

      const trace = await runAndTrace(app, pr.id, agent.id, 1);

      // Whole documents only — no truncation marker, and the survivor is intact.
      expect(trace.prompt_assembly.specs).toContain('alpha beta gamma');
      expect(trace.specs_read[0]).toBe('docs/budget/one.md');
      const droppedLine = trace.specs_read[1]!;
      expect(droppedLine).toContain('docs/budget/two.md');
      expect(droppedLine).toContain('budget');

      // AC-27's second half: the marked set IS the set the run dropped.
      const runDropped = trace.specs_read
        .filter((s) => s.includes('budget (') || s.includes('dropped for budget'))
        .map((s) => s.split(' — ')[0]);
      expect(runDropped).toEqual(markedDropped);

      await rm(join(clone, 'docs', 'budget'), { recursive: true, force: true });
      await app.close();
    });

    it('AC-26 — the projected total equals the section size the run records (BQ-1/a)', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'AgreementAgent');

      for (const path of ['docs/a.md', 'docs/b.md']) {
        await attach(app, { path, repo_id: repo.id, target_kind: 'agent', target_id: agent.id });
      }

      const projection = Projection.parse(
        (await app.inject({ method: 'GET', url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}` })).json(),
      );
      expect(projection.projected_tokens).toBeGreaterThan(0);

      const trace = await runAndTrace(app, pr.id, agent.id, 1);

      // The run records `sectionTokens` on a run-log line precisely so this
      // equality has a recorded value to assert against — the existing
      // prompt-assembly stat counts `assembly.specs` WITHOUT the heading and
      // therefore can never equal a projection that includes it.
      const line = trace.log.find((l) => l.msg.startsWith('project context:') && l.msg.includes('tokens'));
      expect(line).toBeDefined();
      const recorded = Number(/~(\d+) tokens/.exec(line!.msg)![1]);
      expect(recorded).toBe(projection.projected_tokens);

      await app.close();
    });

    /**
     * Fix-brief F2 — the projection and the run must agree for a MULTI-REPO
     * agent, which is the one case the old projection could not get right: it
     * passed each attachment its own repo id as the repo under review, so the
     * cross-repo guard compared `x !== x` and never fired. The page promised to
     * inject a document the run skips.
     *
     * This asserts the two agree on BOTH halves AC-26 names — the same per
     * document outcome, and the same `sectionTokens`.
     */
    it('F2 — a multi-repo agent`s projection and run produce the same outcomes and the same sectionTokens', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));

      const otherClone = join(base, 'f2-other-clone');
      await mkdir(join(otherClone, 'docs'), { recursive: true });
      await writeFile(
        join(otherClone, 'docs', 'other.md'),
        '# Other repo\n\nBELONGS TO A DIFFERENT PROJECT\n',
      );

      const other = await setupRepoAndPr(pg.handle.db, workspaceId, otherClone);
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'MultiRepoAgreementAgent');

      // One document from the repo under review, one from another repo. Both
      // exist on disk and are readable, so the only thing that can distinguish
      // them is which repository they were attached against.
      await attach(app, {
        path: 'docs/a.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      await attach(app, {
        path: 'docs/other.md',
        repo_id: other.repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });

      const projection = Projection.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/agents/${agent.id}/context/projection?repo_id=${repo.id}`,
          })
        ).json(),
      );

      // The page's half: the foreign document is marked `skipped`, which is the
      // "wrong repo" cause `ProjectionOutcome.skipped` documents and which the
      // projection previously could not emit at all.
      expect(projection.entries.map((e) => [e.path, e.outcome])).toEqual([
        ['docs/a.md', 'injected'],
        ['docs/other.md', 'skipped'],
      ]);

      const trace = await runAndTrace(app, pr.id, agent.id, 1);

      // The run's half: same two documents, same two outcomes.
      expect(trace.specs_read).toHaveLength(2);
      expect(trace.specs_read[0]).toBe('docs/a.md');
      expect(trace.specs_read[1]).toContain('docs/other.md');
      expect(trace.specs_read[1]).toContain('different repository');

      // Neither the foreign document nor any same-named local file reached the
      // model — the delimiter assertion goes against `user`, because
      // `JSON.stringify` of the calls escapes the quotes.
      expect(trace.prompt_assembly.user).toContain('cost-plus-14pct');
      expect(trace.prompt_assembly.user).not.toContain('BELONGS TO A DIFFERENT PROJECT');

      // AC-26's number, for the multi-repo shape: the projected total is the
      // section size the run recorded.
      const line = trace.log.find(
        (l) => l.msg.startsWith('project context:') && l.msg.includes('tokens'),
      );
      expect(line).toBeDefined();
      const recorded = Number(/~(\d+) tokens/.exec(line!.msg)![1]);
      expect(recorded).toBe(projection.projected_tokens);

      await app.close();
    });

    it('F3 — a deleted clone skips every document and the run still completes', async () => {
      const app = await appWithMock(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clone);
      const agent = await newAgent(app, 'GoneCloneAgent');

      await attach(app, {
        path: 'docs/a.md',
        repo_id: repo.id,
        target_kind: 'agent',
        target_id: agent.id,
      });
      // The clone disappears between attach and run — a `realpath` that throws
      // must not surface as a failed run, let alone a 500.
      await pg.handle.db
        .update(t.repos)
        .set({ clonePath: join(base, 'vanished') })
        .where(eq(t.repos.id, repo.id));

      const trace = await runAndTrace(app, pr.id, agent.id, 1);

      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
      expect(run!.status).toBe('done');
      expect(trace.prompt_assembly.specs).toBeNull();
      expect(trace.prompt_assembly.user).not.toContain('## Project context');
      // Every document is recorded as skipped, per §6's "Every attached
      // document fails" row — not silently dropped.
      expect(trace.specs_read).toHaveLength(1);
      expect(trace.specs_read[0]).toContain('clone directory is missing');

      await app.close();
    });
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
