import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { summariseBlast, renderMapForPrompt } from '../src/modules/blast/summary.js';
import type { BlastResponse } from '../src/modules/blast/contract.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

/**
 * L04 (B4/B6) — the blast service's three states, and the LLM-call budget.
 *
 * The acceptance criteria this pins down:
 *  - the main scenario makes NO model call, and the optional summary makes
 *    EXACTLY one;
 *  - an unusable index yields `degraded` with an EMPTY map, and the facade is
 *    never asked for one — its ripgrep fallback re-reads the clone, which is
 *    the request-time parsing the criteria forbid;
 *  - `partial` still shows data. Hiding real callers because the index is
 *    incomplete would be worse than saying so.
 */

const PR_ID = 'pr-1';
const WS = 'ws-1';

function indexState(over: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'abc123',
    indexerVersion: 2,
    updatedAt: new Date(0),
    ...over,
  } as IndexState;
}

const OK_BLAST: BlastResult = {
  changedSymbols: [{ file: 'src/helper.ts', name: 'helper', kind: 'function' }],
  callers: [
    { file: 'src/routes.ts', symbol: 'register', viaSymbol: 'helper', line: 12, rank: 5 },
  ],
  impactedEndpoints: ['GET /things'],
  factsByFile: { 'src/routes.ts': { endpoints: ['GET /things'], crons: [] } },
  degraded: false,
};

interface Stubs {
  state?: IndexState;
  blast?: BlastResult;
  changedFiles?: string[];
}

function build(stubs: Stubs = {}) {
  const getBlastRadius = vi.fn(async () => stubs.blast ?? OK_BLAST);
  const complete = vi.fn(async () => ({
    text: 'A short paragraph.',
    model: 'test-model',
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.001,
  }));

  // `resolveFeatureModel` reads per-workspace overrides from `settings`, so the
  // db needs just enough of the Drizzle chain to answer "no overrides".
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  };

  const container = {
    db: db as never,
    repoIntel: {
      getIndexState: async () => stubs.state ?? indexState(),
      getBlastRadius,
      getDependentFiles: async () => [],
      getFileFacts: async () => [],
    },
    llm: async () => ({ complete }),
  } as never;

  const service = new BlastService(container);
  (service as unknown as { repo: Record<string, unknown> }).repo = {
    getPull: async () => ({
      id: PR_ID,
      repoId: 'r1',
      number: 7,
      title: 'PR',
      headSha: 'head999',
    }),
    getRepo: async () => ({ id: 'r1', fullName: 'acme/app' }),
    getChangedFiles: async () => stubs.changedFiles ?? ['src/helper.ts'],
    getPriorPrs: async () => [],
  };

  return { service, container, getBlastRadius, complete };
}

describe('BlastService — states', () => {
  it('an unusable index yields degraded, an empty map, and NEVER asks for a map', async () => {
    const { service, getBlastRadius } = build({
      state: indexState({ status: 'degraded', degradedReason: 'no_data' }),
    });

    const res = await service.forPull(WS, PR_ID);

    expect(res.state).toBe('degraded');
    expect(res.reason).toBe('no_data');
    expect(res.map.changed_symbols).toEqual([]);
    expect(res.map.downstream).toEqual([]);
    expect(res.counts).toEqual({ symbols: 0, callers: 0, endpoints: 0, crons: 0 });
    // The whole point of BD1: the clone-reading fallback is never reached.
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('discards a degraded RESULT rather than rendering clone-derived data', async () => {
    const { service } = build({
      blast: {
        changedSymbols: [{ file: 'a.ts', name: 'x', kind: 'function' }],
        callers: [{ file: 'b.ts', symbol: 'y', viaSymbol: 'x', line: 1, rank: 0 }],
        impactedEndpoints: ['GET /leak'],
        degraded: true,
        reason: 'no_data',
      },
    });

    const res = await service.forPull(WS, PR_ID);

    expect(res.state).toBe('degraded');
    expect(res.map.downstream).toEqual([]);
    expect(JSON.stringify(res)).not.toContain('GET /leak');
  });

  it('a partial index still returns the data, flagged', async () => {
    const { service } = build({ state: indexState({ status: 'partial', filesSkipped: 3 }) });

    const res = await service.forPull(WS, PR_ID);

    expect(res.state).toBe('partial');
    expect(res.reason).toBeTruthy();
    expect(res.map.downstream[0]?.callers).toHaveLength(1);
  });

  it('ok: groups per symbol, attributes endpoints, and counts what it rendered', async () => {
    const { service } = build();

    const res = await service.forPull(WS, PR_ID);

    expect(res.state).toBe('ok');
    expect(res.reason).toBeNull();
    expect(res.map.downstream).toHaveLength(1);
    expect(res.map.downstream[0]?.symbol).toBe('helper');
    expect(res.map.downstream[0]?.endpoints_affected).toEqual(['GET /things']);
    expect(res.counts).toEqual({ symbols: 1, callers: 1, endpoints: 1, crons: 0 });
    // BD4 — the two shas are distinct and both surface.
    expect(res.head_sha).toBe('head999');
    expect(res.indexed_sha).toBe('abc123');
  });

  it('a PR with no changed files is degraded, not silently empty', async () => {
    const { service } = build({ changedFiles: [] });
    const res = await service.forPull(WS, PR_ID);
    expect(res.state).toBe('degraded');
    expect(res.reason).toBe('no_changed_files');
  });
});

describe('blast summary — the LLM budget', () => {
  it('the map itself costs ZERO model calls', async () => {
    const { service, complete } = build();
    await service.forPull(WS, PR_ID);
    expect(complete).not.toHaveBeenCalled();
  });

  it('the summary costs EXACTLY one', async () => {
    const { service, container, complete } = build();
    const blast = await service.forPull(WS, PR_ID);

    const out = await summariseBlast(container, WS, blast);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(out.summary).toBe('A short paragraph.');
    expect(out.model).toBe('test-model');
    expect(out.cost_usd).toBe(0.001);
  });

  it('refuses to summarise a degraded map instead of inventing a paragraph', async () => {
    const { container, complete } = build();
    const degraded = {
      state: 'degraded',
      reason: 'no_data',
      counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      map: { changed_symbols: [], downstream: [] },
    } as unknown as BlastResponse;

    await expect(summariseBlast(container, WS, degraded)).rejects.toThrow(/degraded/i);
    expect(complete).not.toHaveBeenCalled();
  });

  it('fences the map as untrusted data in the prompt', async () => {
    const { service } = build();
    const blast = await service.forPull(WS, PR_ID);
    const rendered = renderMapForPrompt(blast);
    expect(rendered).toContain('helper — 1 caller(s)');
    expect(rendered).toContain('src/routes.ts:12');
    expect(rendered).toContain('reaches endpoint GET /things');
  });
});
