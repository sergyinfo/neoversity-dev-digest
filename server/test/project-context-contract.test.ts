import { describe, it, expect } from 'vitest';
import {
  ContextDocList,
  ContextDocListReason,
  AttachmentInput,
  AttachmentRow,
  Projection,
  ProjectionEntry,
} from '../src/modules/project-context/contract.js';

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
  it('parses a body with an explicit order, and one that leaves ordering to the server', () => {
    const explicit = AttachmentInput.parse({
      path: '.devdigest/specs/prd.md',
      repo_id: 'repo-1',
      target_kind: 'agent',
      target_id: 'agent-1',
      order: 2,
    });
    expect(explicit.order).toBe(2);

    const implicit = AttachmentInput.parse({
      path: '.devdigest/specs/prd.md',
      repo_id: 'repo-1',
      target_kind: 'skill',
      target_id: 'skill-1',
    });
    expect(implicit.order).toBeUndefined();
  });

  it('requires repo_id — a path is only meaningful against the repo it was listed in', () => {
    const body = { path: 'a.md', target_kind: 'agent', target_id: 'agent-1' };
    expect(AttachmentInput.safeParse(body).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...body, repo_id: '' }).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...body, repo_id: 'r1', target_kind: 'repo' }).success).toBe(false);
    expect(AttachmentInput.safeParse({ ...body, repo_id: 'r1', path: '' }).success).toBe(false);
  });

  it('resolves order on the row, where it is always concrete', () => {
    const row = AttachmentRow.parse({
      id: 'att-1',
      path: '.devdigest/specs/prd.md',
      repo_id: 'repo-1',
      target_kind: 'agent',
      target_id: 'agent-1',
      order: 0,
      created_at: '2026-08-29T09:00:00.000Z',
    });
    expect(row.order).toBe(0);

    expect(
      AttachmentRow.safeParse({
        id: 'att-1',
        path: 'a.md',
        repo_id: 'repo-1',
        target_kind: 'agent',
        target_id: 'agent-1',
      }).success,
    ).toBe(false);
  });
});

describe('Projection', () => {
  const entry = {
    path: '.devdigest/specs/prd.md',
    origin: 'agent',
    via_skill_id: null,
    tokens_estimate: 2100,
    outcome: 'injected',
  };

  it('parses a projection whose entries mix direct and inherited documents', () => {
    const projection = Projection.parse({
      agent_id: 'agent-1',
      budget_tokens: 8000,
      projected_tokens: 6400,
      entries: [
        entry,
        {
          path: 'server/docs/intent-layer.md',
          origin: 'skill',
          via_skill_id: 'skill-7',
          tokens_estimate: 4200,
          outcome: 'dropped_budget',
        },
        // Unmeasurable and unreadable: skipped, with no estimate at all.
        { path: 'gone.md', origin: 'agent', outcome: 'skipped' },
      ],
    });

    expect(projection.entries.map((e) => e.outcome)).toEqual(['injected', 'dropped_budget', 'skipped']);
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
  });

  it('requires agent_id and both token figures — a projection is meaningless unattributed', () => {
    const base = { agent_id: 'agent-1', budget_tokens: 8000, projected_tokens: 100, entries: [] };
    expect(Projection.safeParse({ ...base, agent_id: undefined }).success).toBe(false);
    expect(Projection.safeParse({ ...base, budget_tokens: undefined }).success).toBe(false);
    expect(Projection.safeParse({ ...base, projected_tokens: undefined }).success).toBe(false);
    expect(Projection.safeParse({ ...base, projected_tokens: -1 }).success).toBe(false);
    expect(Projection.safeParse({ ...base, entries: [{ path: 'a.md' }] }).success).toBe(false);
  });
});
