# The rings

Inside out. Each section says what belongs, what must never appear, and how to tell.

## Domain — `vendor/shared/contracts/*`, `reviewer-core/`

Truths that hold regardless of transport or storage. Severity levels, verdict rules, what
a finding is, how a diff is grounded.

**Never appears here:** Fastify, Drizzle, `process.env`, HTTP status codes, SQL, table
names.

**The test:** could this run in a script with no server and no database? If not, it is not
domain.

`reviewer-core/` is the reference example — grounding, prompt assembly and reduction are
pure; the only infrastructure is isolated in `src/llm/`.

## Ports — `vendor/shared/adapters.ts`

28 interfaces describing what the application *needs*, in its own words:
`GitHubClient`, `GitClient`, `LLMProvider`, `SecretsProvider`, `CodeIndex`.

A port is owned by the inner ring and implemented by the outer one. That inversion is the
whole mechanism — it is what lets `MockGitClient` stand in for `SimpleGitClient` with no
change to any service.

**Never appears here:** an import of anything concrete. A port that mentions `Octokit` in
its types is not a port.

**Do-not-touch** without coordination — it is vendored in two hand-maintained copies.

## Persistence — `modules/*/repository.ts`, `db/`

The only place SQL exists.

```ts
// ✓ domain vocabulary, contract return type
async findOpenPullsForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]>

// ✗ query vocabulary leaking outward
async selectWhere(cond: SQL): Promise<typeof t.pullRequests.$inferSelect[]>
```

Every query is scoped by `workspaceId` — the tenancy guard is a persistence-layer
responsibility, not something callers remember.

**Never appears here:** HTTP concerns, orchestration across aggregates, LLM calls.

**Leak test:** does any Drizzle type appear in a signature a service can see? If yes, the
ORM has escaped.

## Application — `modules/*/service.ts`, `platform/*`

Orchestration. Sequences repository and port calls, owns transactions, applies rules that
need more than one collaborator.

Depends on **ports**, never on `adapters/`. Receives implementations from the container.

`platform/` holds cross-cutting application concerns — `jobs`, `resilience`,
`model-router`, `errors`, `grounding`. These may be imported by adapters (they are shared
utilities), but `platform/container.ts` and `platform/jobs.ts` may not — those are the
composition root and the orchestrator.

**Never appears here:** `request`/`reply`, status codes, raw SQL, `new SomeAdapter()`.

## Delivery — `modules/*/routes.ts`, `app.ts`, `server.ts`

Translates HTTP to application calls and back. Should read as three steps:

```ts
app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);   // 1. parse
  return service.poll(workspaceId, req.params.id);            // 2. delegate
});                                                            // 3. serialize
```

**Never appears here:** SQL, business rules, retry policies, prompt assembly.

The current `pulls/routes.ts` is the counter-example — 17 inline queries, including read
aggregates that belong in a repository.

## Adapters — `adapters/*`

Concrete implementations of ports: Octokit, simple-git, the OpenAI and Anthropic SDKs,
ripgrep, ast-grep, local secrets.

Leaves of the graph. Wired *by* the container, never reaching back into it.

**Never appears here:** imports from `modules/`. Two current violations — `astgrep` and
`depgraph` read constants out of `modules/repo-intel` — are real and scheduled.

**Misfiling caution:** `adapters/` currently also holds *pure functions*
(`git/diff-parser.ts`, `codeindex/extract.ts`). Importing those from a service is not a
layering violation; it is a sign the file is in the wrong folder. Move it to `platform/`
or the owning module rather than adding an exception.

## Composition root — `platform/container.ts`

The only place that constructs adapters. Resolves each port lazily, caches it, and exposes
it to modules. `ContainerOverrides` is what makes tests hermetic.

```ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;   // tests
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  return (this._github ??= new OctokitGitHubClient(token));
}
```

If you are typing `new` on an adapter anywhere else, stop.

## Facades

`repo-intel` is reached **only** through `container.repoIntel.*`. It is a subsystem with
its own pipeline, exposed as one narrow port so consumers never see the internals. When a
module grows an internal pipeline, give it a facade rather than letting callers reach in.

Its enrichment is best-effort by design: on error or an unindexed repo, omit the section —
never throw. A degraded review beats a failed one.
