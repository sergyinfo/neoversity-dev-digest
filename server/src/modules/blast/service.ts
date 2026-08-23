import type { BlastCaller, ChangedSymbol, DownstreamImpact } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { BlastResponse, BlastState } from './contract.js';
import { isHttpSurface } from './helpers.js';
import { BlastRepository } from './repository.js';

/**
 * L04 — Blast Radius.
 *
 * Answers "what else can this diff touch?" by READING the prebuilt repo-intel
 * index. Three hard rules, each of them an acceptance criterion:
 *
 *  1. **No parsing at request time.** The facts come from `symbols`,
 *     `references`, `file_edges`, `file_rank` and `file_facts`. The last of
 *     those exists precisely so this module never re-reads the clone — see the
 *     comment on `fileFacts` in `db/schema/repo-intel.ts`.
 *  2. **No LLM on this path.** The one-paragraph summary is a separate,
 *     explicitly-requested route. Nothing here touches `container.llm`.
 *  3. **Missing data is never rendered as an empty map.** A `degraded` state
 *     says the impact is UNKNOWN. An empty map on an `ok` state says there is
 *     genuinely no downstream. Collapsing the two would tell a reviewer "this
 *     change is safe" precisely when we cannot know that.
 */

/** Prior-PR block size; the UI collapses it, so a handful is plenty. */
const MAX_PRIOR_PRS = 5;

export class BlastService {
  private readonly repo: BlastRepository;

  constructor(private readonly container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async forPull(workspaceId: string, prId: string): Promise<BlastResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(workspaceId, pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const changedFiles = await this.repo.getChangedFiles(pull.id);
    const base = {
      pr_id: pull.id,
      repo_full_name: repo.fullName,
      head_sha: pull.headSha,
    };

    // ---- BD1: decide from the index state BEFORE asking for a map ----------
    // `getBlastRadius` has a ripgrep fallback that re-reads the clone per caller
    // file. That is exactly the request-time parsing the acceptance criteria
    // forbid, so the state is checked first and its result is never used as a
    // substitute for an index.
    const state = await this.container.repoIntel.getIndexState(pull.repoId);
    const indexedSha = state.lastIndexedSha || null;

    if (state.status !== 'full' && state.status !== 'partial') {
      return {
        ...base,
        indexed_sha: indexedSha,
        state: 'degraded',
        reason: state.degradedReason ?? state.reason ?? state.status,
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        map: { changed_symbols: [], downstream: [] },
        prior_prs: await this.priorPrs(workspaceId, pull, changedFiles),
      };
    }

    if (changedFiles.length === 0) {
      return {
        ...base,
        indexed_sha: indexedSha,
        state: 'degraded',
        reason: 'no_changed_files',
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        map: { changed_symbols: [], downstream: [] },
        prior_prs: [],
      };
    }

    const blast = await this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles);

    // The facade fell through to its clone-reading path. Discard it: a
    // best-effort map served from a stale working copy is worse than an honest
    // "unknown", and it would have parsed during the request.
    if (blast.degraded) {
      return {
        ...base,
        indexed_sha: indexedSha,
        state: 'degraded',
        reason: blast.reason ?? 'no_data',
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        map: { changed_symbols: [], downstream: [] },
        prior_prs: await this.priorPrs(workspaceId, pull, changedFiles),
      };
    }

    // ---- BD3: reach endpoints through the REVERSE import graph -------------
    // Callers give direct references; dependents give the modules that reach the
    // change transitively (depth 2). Their union is where endpoints can live.
    const dependents = await this.container.repoIntel.getDependentFiles(
      pull.repoId,
      changedFiles,
    );
    const callerFiles = [...new Set(blast.callers.map((c) => c.file))];
    const extraFiles = dependents.map((d) => d.file).filter((f) => !callerFiles.includes(f));

    const factsByFile: Record<string, { endpoints: string[]; crons: string[] }> = {
      ...(blast.factsByFile ?? {}),
    };
    if (extraFiles.length > 0) {
      for (const row of await this.container.repoIntel.getFileFacts(pull.repoId, extraFiles)) {
        factsByFile[row.filePath] = { endpoints: row.endpoints, crons: row.crons };
      }
    }

    // ---- Group per changed symbol -----------------------------------------
    const changed_symbols: ChangedSymbol[] = blast.changedSymbols.map((s) => ({
      name: s.name,
      file: s.file,
      kind: s.kind,
    }));

    const bySymbol = new Map<string, BlastCaller[]>();
    for (const c of blast.callers) {
      const arr = bySymbol.get(c.viaSymbol);
      const entry: BlastCaller = { name: c.symbol, file: c.file, line: c.line };
      if (arr) arr.push(entry);
      else bySymbol.set(c.viaSymbol, [entry]);
    }

    // Transitive facts, attributed to the CHANGED FILE they were reached from.
    //
    // Attributing the union of every dependent's endpoints to every symbol was
    // the first thing this returned, and it made the map worthless: a test mock
    // came back "affecting" 31 HTTP endpoints because something, somewhere in
    // the diff, was imported by `app.ts`. The assignment is specific — the path
    // runs *from the changed file* — so the seed is what the fact belongs to.
    const transitiveBySeed = new Map<string, { endpoints: Set<string>; crons: Set<string> }>();
    for (const dep of dependents) {
      if (!isHttpSurface(dep.file)) continue;
      const f = factsByFile[dep.file];
      if (!f || (f.endpoints.length === 0 && f.crons.length === 0)) continue;
      let bucket = transitiveBySeed.get(dep.via);
      if (!bucket) {
        bucket = { endpoints: new Set<string>(), crons: new Set<string>() };
        transitiveBySeed.set(dep.via, bucket);
      }
      for (const e of f.endpoints) bucket.endpoints.add(e);
      for (const c of f.crons) bucket.crons.add(c);
    }

    const downstream: DownstreamImpact[] = changed_symbols.map((sym) => {
      const callers = bySymbol.get(sym.name) ?? [];
      const seeded = transitiveBySeed.get(sym.file);
      const endpoints = new Set(seeded?.endpoints ?? []);
      const crons = new Set(seeded?.crons ?? []);
      // Direct callers contribute their own file's facts.
      for (const c of callers) {
        if (!isHttpSurface(c.file)) continue;
        const f = factsByFile[c.file];
        if (!f) continue;
        for (const e of f.endpoints) endpoints.add(e);
        for (const cr of f.crons) crons.add(cr);
      }
      return {
        symbol: sym.name,
        callers,
        endpoints_affected: [...endpoints],
        crons_affected: [...crons],
      };
    });

    const allEndpoints = new Set<string>();
    const allCrons = new Set<string>();
    for (const d of downstream) {
      for (const e of d.endpoints_affected) allEndpoints.add(e);
      for (const c of d.crons_affected) allCrons.add(c);
    }

    // `partial` means the index is real but incomplete — the map is shown, with
    // a caveat. It is NOT degraded: hiding real callers would be worse.
    const blastState: BlastState = state.status === 'partial' || state.filesSkipped > 0
      ? 'partial'
      : 'ok';

    return {
      ...base,
      indexed_sha: indexedSha,
      state: blastState,
      reason:
        blastState === 'partial'
          ? (state.degradedReason ?? `${state.filesSkipped} file(s) were not indexed`)
          : null,
      counts: {
        symbols: changed_symbols.length,
        callers: blast.callers.length,
        endpoints: allEndpoints.size,
        crons: allCrons.size,
      },
      map: { changed_symbols, downstream },
      prior_prs: await this.priorPrs(workspaceId, pull, changedFiles),
    };
  }

  private async priorPrs(
    workspaceId: string,
    pull: { id: string; repoId: string },
    files: string[],
  ) {
    const rows = await this.repo.getPriorPrs(
      workspaceId,
      pull.repoId,
      pull.id,
      files,
      MAX_PRIOR_PRS,
    );
    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      author: r.author,
      updated_at: (r.updatedAt ?? new Date(0)).toISOString(),
      overlapping_files: r.overlappingFiles,
    }));
  }
}
