import { describe, it, expect } from 'vitest';
import {
  ContextDocList,
  ContextDocListReason,
  AttachmentInput,
  AttachmentRow,
  Projection,
  ProjectionEntry,
} from '../src/modules/project-context/contract.js';
import {
  MAX_ATTACHMENT_ORDER,
  MAX_ATTACHMENT_PATH_LEN,
} from '../src/modules/project-context/constants.js';

/**
 * L05 (S2) — the module-local Project Context envelopes.
 *
 * `server/src/modules/project-context/contract.ts` is the declared source of
 * truth for these shapes, and the client keeps its own copies. Nothing in this
 * server validates a response on the way out (no route declares a Zod
 * `response:` schema), so these schemas are only worth what a test that parses
 * real payloads against them is worth — hence this file.
 *
 * The fixtures below are payload-shaped rather than hand-picked field lists, so
 * that the route tests added later can reuse the same schemas against live
 * responses without the shapes having drifted in the meantime.
 *
 * What is pinned down here:
 *  - the three-value `reason` vocabulary (cross-review F3) — "never cloned",
 *    "clone gone from disk" and "walked, genuinely empty" are three different
 *    facts and the schema must not let them collapse into one;
 *  - the §10 field NAMES, since three tracks and the client encode them
 *    independently;
 *  - `outcome` and `origin` as closed enums, so a typo cannot pass as data.
 */

describe('ContextDocList', () => {
  it('parses a populated listing, with the optional SpecFile fields carried through', () => {
    const list = ContextDocList.parse({
      files: [
        {
          path: '.devdigest/specs/prd.md',
          size: 8123,
          updated_at: '2026-08-29T09:00:00.000Z',
          tokens_estimate: 2030,
          over_cap: false,
          used_by_count: 2,
        },
        // A row that could not be measured: absent, not zeroed.
        { path: 'server/docs/intent-layer.md' },
      ],
      capped: false,
      reason: null,
      last_synced_at: '2026-08-29T08:30:00.000Z',
    });

    expect(list.files).toHaveLength(2);
    expect(list.files[0]?.tokens_estimate).toBe(2030);
    expect(list.files[1]?.tokens_estimate).toBeUndefined();
    expect(list.reason).toBeNull();
  });

  it('keeps the three empty-list outcomes distinct (F3)', () => {
    // Walked, and the repo really has nothing.
    expect(ContextDocList.parse({ files: [], capped: false, reason: null, last_synced_at: null }).reason).toBeNull();

    // `clone_path` is null — never cloned.
    expect(
      ContextDocList.parse({ files: [], capped: false, reason: 'not_cloned', last_synced_at: null }).reason,
    ).toBe('not_cloned');

    // `clone_path` is set but the directory is gone: a broken local state a
    // resync repairs, NOT a repo that was never set up.
    expect(
      ContextDocList.parse({
        files: [],
        capped: false,
        reason: 'clone_missing',
        last_synced_at: '2026-08-20T00:00:00.000Z',
      }).reason,
    ).toBe('clone_missing');

    expect(ContextDocListReason.options).toEqual(['not_cloned', 'clone_missing']);
  });

  it('rejects an invented reason, a missing cap flag and a missing sync time', () => {
    const base = { files: [], capped: false, reason: null, last_synced_at: null };
    expect(ContextDocList.safeParse({ ...base, reason: 'error' }).success).toBe(false);
    expect(ContextDocList.safeParse({ ...base, capped: undefined }).success).toBe(false);
    expect(ContextDocList.safeParse({ ...base, last_synced_at: undefined }).success).toBe(false);
    expect(ContextDocList.safeParse({ ...base, files: [{ size: 1 }] }).success).toBe(false);
  });
});

describe('AttachmentInput / AttachmentRow', () => {
  /**
   * Real uuids, because every id-shaped field in this module's REQUEST schemas
   * is `.uuid()` (fix-brief F9) — the `IdParams` convention from
   * `_shared/schemas.ts:11`, which exists so "an invalid id becomes a clean 422
   * instead of a downstream DB/500". These used to be `'repo-1'`/`'agent-1'`.
   */
  const REPO = '11111111-1111-4111-8111-111111111111';
  const AGENT = '22222222-2222-4222-8222-222222222222';
  const SKILL = '33333333-3333-4333-8333-333333333333';
  const ATT = '44444444-4444-4444-8444-444444444444';

  it('parses a body with an explicit order, and one that leaves ordering to the server', () => {
    const explicit = AttachmentInput.parse({
      path: '.devdigest/specs/prd.md',
      repo_id: REPO,
      target_kind: 'agent',
      target_id: AGENT,
      order: 2,
    });
    expect(explicit.order).toBe(2);

    const implicit = AttachmentInput.parse({
      path: '.devdigest/specs/prd.md',
      repo_id: REPO,
      target_kind: 'skill',
      target_id: SKILL,
    });
    expect(implicit.order).toBeUndefined();
  });

  it('requires repo_id — a path is only meaningful against the repo it was listed in', () => {
    const body = { path: 'a.md', target_kind: 'agent', target_id: AGENT };
    expect(AttachmentInput.safeParse(body).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...body, repo_id: '' }).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...body, repo_id: REPO, target_kind: 'repo' }).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...body, repo_id: REPO, path: '' }).success).toBe(false);
  });

  /**
   * F9 — an id that is not a uuid is refused by the SCHEMA.
   *
   * Without this the string reaches `eq(t.agents.id, id)` against a `uuid`
   * column, Postgres raises 22P02, and `app.ts:160-163` returns
   * `message: e.message` — the raw Postgres text — as a 500.
   */
  it('F9 — repo_id and target_id must be uuids', () => {
    const ok = { path: 'docs/a.md', repo_id: REPO, target_kind: 'agent', target_id: AGENT };
    expect(AttachmentInput.safeParse(ok).success).toBe(true);
    for (const bad of ['not-a-uuid', '1', "1'; drop table x --", `${REPO}x`]) {
      expect(AttachmentInput.safeParse({ ...ok, repo_id: bad }).success).toBe(false);
      expect(AttachmentInput.safeParse({ ...ok, target_id: bad }).success).toBe(false);
    }
  });

  /**
   * F10 — `path` and `order` carry bounds.
   *
   * `path` is the third column of the btree index `ctx_att_agent_repo_path_uq`,
   * so this is the `symbols.name` failure from the same schema file
   * (`db/schema/context.ts:23-34`) one table over: past ~2704 bytes Postgres
   * rejects the index row outright. `order` is an `integer` column. Both would
   * otherwise be 500s carrying the raw database message — and `attach` does not
   * even reach `readDoc` when `clone_path` is null, so nothing else stands
   * between the request and the insert.
   */
  it('F10 — path length and order magnitude are bounded at the edge', () => {
    const ok = { path: 'docs/a.md', repo_id: REPO, target_kind: 'agent', target_id: AGENT };

    expect(AttachmentInput.safeParse({ ...ok, path: 'a'.repeat(MAX_ATTACHMENT_PATH_LEN) }).success).toBe(true);
    expect(AttachmentInput.safeParse({ ...ok, path: 'a'.repeat(MAX_ATTACHMENT_PATH_LEN + 1) }).success).toBe(false);
    // The size the finding names — comfortably over the btree row limit.
    expect(AttachmentInput.safeParse({ ...ok, path: 'a'.repeat(2704) }).success).toBe(false);

    expect(AttachmentInput.safeParse({ ...ok, order: MAX_ATTACHMENT_ORDER }).success).toBe(true);
    expect(AttachmentInput.safeParse({ ...ok, order: MAX_ATTACHMENT_ORDER + 1 }).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...ok, order: 2 ** 31 }).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...ok, order: -1 }).success).toBe(false);
    // Absent is still the documented "server resolves a stable order" case.
    expect(AttachmentInput.safeParse({ ...ok, order: null }).success).toBe(true);
  });

  it('resolves order on the row, where it is always concrete', () => {
    const row = AttachmentRow.parse({
      id: ATT,
      path: '.devdigest/specs/prd.md',
      repo_id: REPO,
      target_kind: 'agent',
      target_id: AGENT,
      order: 0,
      created_at: '2026-08-29T09:00:00.000Z',
    });
    expect(row.order).toBe(0);

    expect(
      AttachmentRow.safeParse({
        id: ATT,
        path: 'a.md',
        repo_id: REPO,
        target_kind: 'agent',
        target_id: AGENT,
      }).success,
    ).toBe(false);
  });
});

describe('Projection', () => {
  const entry = {
    path: '.devdigest/specs/prd.md',
    repo_id: 'repo-1',
    origin: 'agent',
    via_skill_id: null,
    tokens_estimate: 2100,
    outcome: 'injected',
  };

  it('parses a projection whose entries mix direct and inherited documents', () => {
    const projection = Projection.parse({
      agent_id: 'agent-1',
      repo_id: 'repo-1',
      budget_tokens: 8000,
      projected_tokens: 6400,
      entries: [
        entry,
        {
          path: 'server/docs/intent-layer.md',
          repo_id: 'repo-1',
          origin: 'skill',
          via_skill_id: 'skill-7',
          tokens_estimate: 4200,
          outcome: 'dropped_budget',
        },
        // Unmeasurable and unreadable: skipped, with no estimate at all.
        { path: 'gone.md', repo_id: 'repo-1', origin: 'agent', outcome: 'skipped' },
        // F2/F3 — a document attached against ANOTHER repository. It is listed,
        // as `skipped`, and `repo_id` is the only thing that says why: without
        // it this row is indistinguishable from `gone.md` above, and `path`
        // alone is not a unique key across the list.
        {
          path: '.devdigest/specs/prd.md',
          repo_id: 'repo-2',
          origin: 'agent',
          outcome: 'skipped',
        },
      ],
    });

    expect(projection.entries.map((e) => e.outcome)).toEqual([
      'injected',
      'dropped_budget',
      'skipped',
      'skipped',
    ]);
    // Two entries, same path, different repositories — the pair a path-keyed
    // dedupe or render key collapses (F3).
    const prd = projection.entries.filter((e) => e.path === '.devdigest/specs/prd.md');
    expect(prd.map((e) => e.repo_id)).toEqual(['repo-1', 'repo-2']);
    expect(projection.entries[1]?.via_skill_id).toBe('skill-7');
    expect(projection.entries[2]?.tokens_estimate).toBeUndefined();
    // Deliberately NOT the sum of the entries: the total includes the wrappers
    // and the section heading, so a consumer must read it, not recompute it.
    expect(projection.projected_tokens).toBe(6400);
  });

  it('closes the outcome and origin vocabularies', () => {
    expect(ProjectionEntry.safeParse({ ...entry, outcome: 'dropped' }).success).toBe(false);
    expect(ProjectionEntry.safeParse({ ...entry, outcome: 'over_cap' }).success).toBe(false);
    expect(ProjectionEntry.safeParse({ ...entry, origin: 'repo' }).success).toBe(false);
    expect(ProjectionEntry.safeParse({ path: 'a.md', outcome: 'injected' }).success).toBe(false);
    // `repo_id` is required on every entry, not only on the envelope (F3).
    expect(ProjectionEntry.safeParse({ ...entry, repo_id: undefined }).success).toBe(false);
  });

  it('requires agent_id, repo_id and both token figures — a projection is meaningless unattributed', () => {
    const base = {
      agent_id: 'agent-1',
      repo_id: 'repo-1',
      budget_tokens: 8000,
      projected_tokens: 100,
      entries: [],
    };
    expect(Projection.safeParse({ ...base, agent_id: undefined }).success).toBe(false);
    // F2 — a projection that does not name the repository it was computed for
    // cannot be compared with a run, because the run's cross-repo skip depends
    // on exactly that.
    expect(Projection.safeParse({ ...base, repo_id: undefined }).success).toBe(false);
    expect(Projection.safeParse({ ...base, budget_tokens: undefined }).success).toBe(false);
    expect(Projection.safeParse({ ...base, projected_tokens: undefined }).success).toBe(false);
    expect(Projection.safeParse({ ...base, projected_tokens: -1 }).success).toBe(false);
    expect(Projection.safeParse({ ...base, entries: [{ path: 'a.md' }] }).success).toBe(false);
  });
});
