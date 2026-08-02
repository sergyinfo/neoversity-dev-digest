# Clearing the baseline

16 warnings at introduction. Each step below is independently shippable and ends with
promoting one rule to `error`. Nothing here is urgent; the value is that the count only
moves down.

Re-check after every step:

```sh
cd server && pnpm lint:arch
```

## 1. `workspace` — 1 query

Smallest possible proof of the shape. Add `modules/workspace/repository.ts`, move the query,
call it from the route.

Thin-module exemption applies: no orchestration, so no service is needed —
`routes → repository` is fine. SQL still leaves `routes.ts`.

## 2. `settings` and `polling` — 3 queries each

Same move. `polling` is the more interesting one: its route body is a genuine orchestration
(fetch PRs from GitHub, upsert each, bump `lastPolledAt`), so it earns a real
`service.ts` with the repository underneath.

Note while you are there: `updateClonePath()` bumping `lastPolledAt` is why a repo can read
"synced" having never fetched a PR. Recorded in `server/INSIGHTS.md`; fixing it is a
separate change, not part of this migration.

## 3. `pulls` — 17 queries

The real work, and worth splitting:

- Simple reads → `repository.ts`.
- The PR-list aggregate (score and cost computed on read, with the 120s batch-window heuristic) → its own `repository/aggregate.repo.ts`, following the `reviews/repository/*.repo.ts` precedent.
- Anything that sequences several of those → `service.ts`.

Then promote **`no-sql-in-routes` → `error`**.

## 4. Retype `reviews/service.ts` off `AgentRow`

One type-only import from `db/rows.js`. Add the field set the service actually needs as a
contract type and use that. Remember the vendored contracts are **two hand-maintained
copies** — server and client must move in lock-step.

## 5. Move the pure helpers out of `adapters/`

`git/diff-parser.ts`, `codeindex/extract.ts` and the ast-grep helpers are pure functions
filed under `adapters/`. They are not adapters; nothing about them talks to the outside
world.

Move to `platform/` (if generic) or into the owning module (if repo-intel-specific). This
clears **`no-concrete-adapters-in-app-layer`** → promote to `error`.

## 6. Constants out of `modules/repo-intel`

`adapters/astgrep` and `adapters/depgraph` import constants from `modules/repo-intel`, and
`modules/repos/service.ts` does the same. Two rules, one root cause: shared constants living
inside a feature module.

Move them to the adapter that owns them, or to `platform/` if genuinely shared. `repos/service.ts`
should go through the `container.repoIntel` facade instead.

Clears **`no-inward-to-outward`** and **`no-cross-module-imports`** → promote both.

## 7. Break the cycles

Five, in two groups.

**repo-intel ↔ container** (4). `service.ts` and the pipelines import the container, which
constructs the service. Break by passing what the pipeline needs as arguments rather than
handing it the container — the pipeline should receive a `CodeIndex` and a `GitClient`, not
a service locator.

**agents `helpers.ts` ↔ `repository.ts`** (1). Small and local: whichever direction is
less natural, invert it — usually the helper should take data as a parameter instead of
fetching it.

Then promote **`no-circular` → `error`**, which is the one that keeps the rest honest.

## 8. Orphans

`platform/trace-builder.ts` and `platform/model-router.ts` are unreferenced. Either they
are for a lesson still to come, or they are dead. Decide per file; `no-orphans` can stay
`warn` indefinitely if they are intentional.

## Order rationale

Ascending by risk, and each step makes the next easier to see. The two `error`-level
promotions with the most protective value — `no-sql-in-routes` and `no-circular` — sit at
the ends: the first is mechanical and unblocks the most code, the last needs the rest done
to be achievable.
