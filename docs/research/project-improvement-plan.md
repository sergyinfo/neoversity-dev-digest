# Project improvement plan

Whole-repo analysis, 2026-08-02, using `onion-architecture`, `frontend-ui-architecture`,
`react-best-practices` and `next-best-practices`.

Every finding below is measured, and the command is given so it can be re-checked.

---

## What is already healthy

Worth stating first, because it bounds the work — this is not a codebase in trouble.

| Area | Evidence |
|---|---|
| `useEffect` hygiene | 17 in the whole client; **zero** misused for derived state. The two flagged by a heuristic scan read DOM/`localStorage` on mount — genuine external-system syncs |
| Conditional rendering | **zero** `{count && …}` truthiness traps |
| Component size | only 3 files over 200 lines, one of them vendored |
| Root layout | a **server component** — the most common App Router mistake is absent |
| Ports layer | 28 interfaces in `vendor/shared/adapters.ts`; substitution via `ContainerOverrides` is real, not theoretical |
| Module layering | 5 of 9 server modules have the full `routes → service → repository` chain and **zero** queries in routes |
| Tests | 101 server + 43 client + 7 e2e flows, all green |

---

## P1 — real defects

### 1.1 repo-intel has no tenancy guard at all

**The most serious finding.** Root `AGENTS.md` states the invariant:

> *"Multi-tenancy: every domain table has `workspace_id`; queries are scoped by the base-repository guard."*

For repo-intel this is not true, at three levels at once:

- `db/schema/repo-intel.ts` — its tables are keyed by `repoId` and have **no `workspace_id` column**, unlike every other domain table.
- `modules/repo-intel/repository.ts` — **24 queries, zero occurrences of `workspaceId`**.
- `modules/repo-intel/routes.ts:38` — calls `await getContext(container, req);` and **discards the result**, then passes `req.params.id` straight through. Nothing checks that the repo belongs to the caller's workspace.

So the entire indexer subsystem is reachable by any repo id.

**Current exploitability is low** — this is a local-first, single-workspace app with no auth. But the schema everywhere else anticipates multi-tenancy, so this is a gap that becomes a cross-tenant read the day a second workspace exists.

**Fix:** validate `repoId` against `workspaceId` at the route (or in a shared guard in
`modules/_shared/`) before anything reaches repo-intel. Adding `workspace_id` to the
repo-intel tables is the thorough version and needs a migration — the route guard is the
cheap correct step.

```
grep -c workspaceId server/src/modules/repo-intel/repository.ts   # → 0
sed -n '36,40p' server/src/modules/repo-intel/routes.ts           # → discarded getContext
```

### 1.2 Drizzle types cross the repository boundary — systemic

`onion-architecture` → *"Drizzle never leaks past `repository.ts`."* It leaks in four
modules, in **public signatures**, not just internally:

```
modules/reviews/repository.ts:34   getRepo(id): Promise<typeof t.repos.$inferSelect | undefined>
modules/reviews/repository.ts:38   getPrFiles(prId): Promise<(typeof t.prFiles.$inferSelect)[]>
modules/reviews/repository/pull.repo.ts:24,32   same
modules/agents/repository.ts:47    skill: typeof t.skills.$inferSelect
modules/repos/repository.ts:10     export type RepoRow = typeof t.repos.$inferSelect
db/rows.ts:12                      export type AgentRow = typeof t.agents.$inferSelect
```

`modules/reviews/service.ts` then uses `AgentRow` in three signatures (49, 106, 118), so the
application layer is typed in database terms. Change a column and the type error surfaces in
a service, which is exactly what the repository boundary exists to prevent.

**`dependency-cruiser` cannot catch this** — it is a type-shape problem, not an import
graph problem. It needs review discipline, which is why it belongs in the skill checklist.

**Fix:** give each repository a return type from `vendor/shared/contracts`. Start with
`reviews`, which has both the leak and its consumer.

**False alarm checked and dismissed:** `BlastCallerRow` and `FileRankRow` in
`modules/repo-intel/types.ts` are hand-written domain interfaces that merely end in "Row".
Not a leak.

### 1.3 SQL in HTTP handlers — 24 queries, 4 modules

Already the largest item in the `lint:arch` baseline.

| Module | Queries in `routes.ts` | service | repository |
|---|---|---|---|
| `pulls` | 17 | — | — |
| `polling` | 3 | — | — |
| `settings` | 3 | — | — |
| `workspace` | 1 | — | — |

Exact correlation: the four modules that skip service and repository are the four that
write SQL in routes.

Ordered plan already exists in
[`onion-architecture/reference/migration.md`](../../.claude/skills/onion-architecture/reference/migration.md).

---

## P2 — architecture drift (already in the lint baseline)

`cd server && pnpm lint:arch` → 16 warnings, 0 errors. These are the remaining classes:

| Rule | Count | Note |
|---|---|---|
| `no-circular` | 5 | 4 are repo-intel service/pipelines cycling through the container — the pipelines take the container as a service locator instead of the two ports they need. 1 is `agents/helpers ↔ agents/repository`, small and local |
| `no-inward-to-outward` | 2 | `adapters/astgrep` and `adapters/depgraph` read constants out of `modules/repo-intel` |
| `no-concrete-adapters-in-app-layer` | 2 | Both are **pure functions misfiled** under `adapters/` (`codeindex/extract.ts`, `astgrep/index.ts`). Move the file rather than add an exception |
| `no-cross-module-imports` | 1 | `repos/service.ts` reaches into repo-intel constants instead of the `container.repoIntel` facade |
| `no-orphans` | 2 | `platform/trace-builder.ts`, `platform/model-router.ts` — unreferenced. Either they are for a future lesson or they are dead |

Each fix ends with promoting one rule from `warn` to `error`.

---

## P3 — frontend cleanups

### 3.1 Dead component

`client/src/components/mermaid-diagram/` has **zero importers** anywhere in the client.
Delete it, or wire it up if a lesson needs it.

```
grep -rn "mermaid-diagram" client/src --include="*.tsx" --include="*.ts" | grep -v "^client/src/components/mermaid-diagram/"
# → no results
```

### 3.2 The design-system barrel

`client/src/vendor/ui/index.ts` has **10 `export *`** re-exports, and every component imports
from it (`import { Button, Chip } from "@devdigest/ui"`). `frontend-ui-architecture` →
*"`export *` defeats tree-shaking, inflates the module graph, and slows builds, linting and
type-checking."*

This is the one place where the barrel cost is actually paid at scale, and also the hardest
to change — it is the public face of the vendored design system, and `vendor/` is
do-not-touch.

**Recommendation: measure before acting.** Run a bundle analysis; if the client ships the
whole `vendor/ui` graph on every route, address it via `optimizePackageImports` in
`next.config.ts` rather than by rewriting imports. Do not churn 200 import sites on
principle.

The other 45 `index.ts` files outside `vendor/` are single-component re-exports with only
4 using `export *` — that is within what the skill tolerates.

### 3.3 Array index as key — assess, mostly leave

8 sites. `react-best-practices` says never use an index key when a list *can be reordered,
filtered, or modified*. Checked each:

- Low risk, leave: `Skeleton key={i}` (fixed-length placeholder), `FileCard key={i}` (diff files, static per PR), `ToolCallRow key={i}` (append-only), highlight spans in `PromptModalBody`/`TraceBody`.
- No site was found where the list reorders or filters.

**Verdict: no action.** Listed so a future reviewer does not re-litigate it. If any of those
lists gains a filter, the key must change in the same commit.

### 3.4 Single-consumer shared components

`components/page-shell/` has one consumer (`app/page.tsx`). `frontend-ui-architecture` says
demote when shared code turns out to have one consumer. Low value — flagged for awareness,
not scheduled.

`components/showcase/` is imported only by `test/smoke.test.tsx`, which is its purpose (a
component gallery for the theme smoke test). Legitimate.

---

## P4 — the skills contradict each other

Found while running this analysis, and it will mislead future agents.

**`react-best-practices` says:**
> "Container components fetch data; presentational components receive props and render UI"
> "Max 200 lines per component — split if larger"

**`frontend-ui-architecture` says:**
> "Do not use container/presentational splitting. Its own author retracted it… Do not introduce `FooContainer` wrappers in new code."
> "Do not split because a file 'feels long'. A 300-line component with one job is fine."

Both load automatically. An agent asking "should I split this component?" gets opposite
answers depending on which skill fires.

**Recommendation:** amend `react-best-practices`. Replace the container/presentational bullet
with the hook-based split, and change the 200-line rule from a threshold to a smell
("length is a prompt to check responsibilities, not a reason to split"). The newer skill is
the better-sourced of the two — the retraction is documented in Dan Abramov's own article.

### Also: `next-best-practices` is largely not applicable here

Measured: 59 of 243 client files carry `'use client'`, 5 `page.tsx` files are client
components, there is **1** async server component and **zero** Server Actions.

That is not a defect. The product is a local studio: a Fastify API owns all data access and
the Next app is a client-rendered console talking to it over REST. Adopting RSC would mean
moving data access into the Next server and duplicating the API.

**The action is documentation, not code:** state in `client/AGENTS.md` that the client is
deliberately client-rendered, so no future agent "fixes" it by pushing data fetching into
server components.

---

## Suggested order

| # | Item | Why here | Rough size |
|---|---|---|---|
| 1 | repo-intel workspace guard (1.1) | Only correctness defect; cheap at the route | S |
| 2 | Fix the two skill contradictions (P4) | Every later change is guided by these | S |
| 3 | Delete `mermaid-diagram`, decide on the 2 orphans | Pure subtraction | S |
| 4 | `workspace` → repository, then `settings`, `polling` (1.3) | Proves the shape on the smallest module | M |
| 5 | Move misfiled pure helpers out of `adapters/` (P2) | Unblocks one lint promotion | S |
| 6 | Repository return types off `$inferSelect`, `reviews` first (1.2) | Systemic but mechanical | M |
| 7 | `pulls` → service + repository (1.3) | The bulk of the SQL-in-routes work | L |
| 8 | Break the repo-intel ↔ container cycles (P2) | Needs 5–7 done to be clean | M |
| 9 | Bundle-measure `vendor/ui` before touching it (3.2) | Measurement first; may be a config change | S then ? |

Items 1–3 are worth doing regardless. Items 4–8 are the `lint:arch` baseline going to zero,
each ending in a rule promoted to `error`.

## How this was measured

```sh
cd server && pnpm lint:arch                    # 16 warnings, 0 errors
grep -c workspaceId src/modules/repo-intel/repository.ts
grep -rn 'inferSelect' src/modules/*/repository.ts src/modules/*/repository/*.ts
# client
grep -rl "^['\"]use client" src | wc -l
find src -name "*.tsx" ! -name "*.test.tsx" -exec wc -l {} + | sort -rn | awk '$1>200'
grep -rn "key={i}\|key={idx}\|key={index}" --include="*.tsx" src
```

Query counts in routes were taken with a **multi-line-aware** matcher — Drizzle chains break
across lines, and a line-based `grep` undercounts them by roughly 3×.
