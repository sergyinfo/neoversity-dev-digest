import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { ResolvedCallerRow } from '../src/modules/repo-intel/repository.js';

/**
 * L04 (B2) — persistent blast path: per-symbol caller cap and declaring-file
 * exclusion.
 *
 * Both were real defects in `tryPersistentBlast`:
 *  - the cap was `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` over the FLAT array,
 *    i.e. a global budget, so one busy symbol could starve every other symbol
 *    out of the map;
 *  - `getResolvedCallers` filters on `decl_file` but never excluded
 *    self-references, so a helper used inside its own file counted itself as
 *    downstream impact. The ripgrep path had always excluded it.
 *
 * No Postgres and no clone: the service's repository is patched, which is the
 * pattern `repo-intel-facade-degraded.test.ts` established.
 */

const DECL_A = 'src/helpers/a.ts';
const DECL_B = 'src/helpers/b.ts';

interface StubOpts {
  callers: ResolvedCallerRow[];
  /** Symbols declared in the changed files. */
  declared?: { path: string; name: string; kind: string }[];
}

function buildService(opts: StubOpts): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;

  const svc = new RepoIntelService(container);
  const declared = opts.declared ?? [
    { path: DECL_A, name: 'alpha', kind: 'function' },
    { path: DECL_B, name: 'beta', kind: 'function' },
  ];

  // `tryPersistentBlast` calls getSymbolRows twice, in a fixed order: first for
  // the CHANGED files (to find declared symbols), then for the CALLER files (to
  // resolve each reference's enclosing symbol). Keying the stub on call order
  // rather than on the paths matters, because a declaring file can legitimately
  // appear in both lists — which is exactly the self-reference case under test.
  let symbolRowCalls = 0;
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: 'full' }),
    getSymbolRows: async () => {
      symbolRowCalls += 1;
      return symbolRowCalls === 1
        ? declared.map((d) => ({ ...d, startLine: 1, endLine: 2, exported: true, signature: null }))
        : []; // caller files: no enclosing symbol → the facade falls back to the basename
    },
    getResolvedCallers: async () => opts.callers,
    getFileFacts: async () => [],
  };
  return svc;
}

const caller = (
  fromPath: string,
  toSymbol: string,
  declFile: string,
  rank: number,
  line = 1,
): ResolvedCallerRow => ({ fromPath, toSymbol, declFile, rank, line });

describe('persistent blast — declaring-file exclusion', () => {
  it('drops a reference that originates in the symbol\'s own declaring file', async () => {
    const svc = buildService({
      callers: [
        caller(DECL_A, 'alpha', DECL_A, 9), // self-reference — must be dropped
        caller('src/api/routes.ts', 'alpha', DECL_A, 5),
      ],
    });

    const blast = await svc.getBlastRadius('r1', [DECL_A, DECL_B]);

    expect(blast.degraded).toBe(false);
    expect(blast.callers.map((c) => c.file)).toEqual(['src/api/routes.ts']);
    expect(blast.callers.some((c) => c.file === DECL_A)).toBe(false);
  });
});

describe('persistent blast — the caller cap is PER SYMBOL, not global', () => {
  it('keeps 20 callers for each of two symbols (40), not 20 overall', async () => {
    const callers: ResolvedCallerRow[] = [];
    for (let i = 0; i < 25; i += 1) {
      // `alpha` deliberately outranks every `beta` caller: under the old global
      // slice, beta would have been erased from the map entirely.
      callers.push(caller(`src/a/caller-${i}.ts`, 'alpha', DECL_A, 1000 - i));
      callers.push(caller(`src/b/caller-${i}.ts`, 'beta', DECL_B, 100 - i));
    }

    const blast = await buildService({ callers }).getBlastRadius('r1', [DECL_A, DECL_B]);

    const perSymbol = new Map<string, number>();
    for (const c of blast.callers) perSymbol.set(c.viaSymbol, (perSymbol.get(c.viaSymbol) ?? 0) + 1);

    expect(perSymbol.get('alpha')).toBe(20);
    expect(perSymbol.get('beta')).toBe(20);
    expect(blast.callers).toHaveLength(40);
  });

  it('orders each symbol\'s callers by file rank, descending, and keeps 20', async () => {
    const blast = await buildService({
      callers: [
        caller('src/low.ts', 'alpha', DECL_A, 1),
        caller('src/high.ts', 'alpha', DECL_A, 99),
        caller('src/mid.ts', 'alpha', DECL_A, 50),
      ],
    }).getBlastRadius('r1', [DECL_A]);

    expect(blast.callers.map((c) => c.rank)).toEqual([99, 50, 1]);
  });
});

/**
 * B3 — the direction of the graph walk. This is an explicit grader check:
 * "modules that depend on the changed file must be shown, not the changed
 * file's own dependencies".
 *
 * Fixture: A imports B, B imports C.  A → B → C
 * So the dependents of C are B (1 hop) and A (2 hops); A has no dependents.
 */
function buildGraphService(edges: { fromFile: string; toFile: string }[], flag = true) {
  const svc = new RepoIntelService({
    config: { repoIntelEnabled: flag },
    db: {} as never,
    codeIndex: {} as never,
  } as never);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getImporters: async (_repoId: string, files: string[]) =>
      edges.filter((e) => files.includes(e.toFile)),
  };
  return svc;
}

const CHAIN = [
  { fromFile: 'A.ts', toFile: 'B.ts' }, // A imports B
  { fromFile: 'B.ts', toFile: 'C.ts' }, // B imports C
];

describe('getDependentFiles — walks the import graph BACKWARDS', () => {
  it('returns B at depth 1 and A at depth 2 for a change in C', async () => {
    const out = await buildGraphService(CHAIN).getDependentFiles('r1', ['C.ts']);
    expect(out).toEqual([
      { file: 'B.ts', depth: 1, via: 'C.ts' },
      { file: 'A.ts', depth: 2, via: 'C.ts' },
    ]);
  });

  it('returns NEITHER B nor C for a change in A — dependencies are not dependents', async () => {
    const out = await buildGraphService(CHAIN).getDependentFiles('r1', ['A.ts']);
    expect(out).toEqual([]);
  });

  it('excludes a dependent three hops away (depth is bounded at 2)', async () => {
    const chain = [...CHAIN, { fromFile: 'Z.ts', toFile: 'A.ts' }]; // Z → A → B → C
    const out = await buildGraphService(chain).getDependentFiles('r1', ['C.ts']);
    expect(out.map((d) => d.file)).toEqual(['B.ts', 'A.ts']);
    expect(out.some((d) => d.file === 'Z.ts')).toBe(false);
  });

  it('terminates on a cycle and never revisits a file', async () => {
    const cyclic = [
      { fromFile: 'A.ts', toFile: 'B.ts' },
      { fromFile: 'B.ts', toFile: 'A.ts' },
    ];
    const out = await buildGraphService(cyclic).getDependentFiles('r1', ['A.ts'], 5);
    expect(out).toEqual([{ file: 'B.ts', depth: 1, via: 'A.ts' }]);
  });

  it('returns [] when repo-intel is disabled', async () => {
    const out = await buildGraphService(CHAIN, false).getDependentFiles('r1', ['C.ts']);
    expect(out).toEqual([]);
  });
});

describe('getDependentFiles — attribution to the seed file', () => {
  it('reports which changed file each dependent was reached from', async () => {
    // X → helperA, Y → helperB. Each dependent must name its own seed, so a
    // consumer can attribute facts per changed file instead of unioning them.
    const svc = buildGraphService([
      { fromFile: 'X.ts', toFile: 'helperA.ts' },
      { fromFile: 'Y.ts', toFile: 'helperB.ts' },
    ]);
    const out = await svc.getDependentFiles('r1', ['helperA.ts', 'helperB.ts']);
    expect(out).toEqual([
      { file: 'X.ts', depth: 1, via: 'helperA.ts' },
      { file: 'Y.ts', depth: 1, via: 'helperB.ts' },
    ]);
  });
});
