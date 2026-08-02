# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-08-02** — A successful `git clone` proves NOTHING about the stored GitHub PAT. `runCloneJob` only injects the token when one exists (`const cloneUrl = token ? withGitHubToken(url, token) : url`), and the adapter never rewrites `origin` afterwards — so if the remote has no embedded credentials, git silently fell back to ambient creds (macOS keychain / SSH) and the PAT was never exercised. Check `git -C <clone> remote get-url origin` before concluding the token works. Evidence: `server/src/modules/repos/service.ts:54`, `server/src/adapters/git/simple-git.ts:54`.
- **2026-08-02** — `updateClonePath()` bumps `lastPolledAt` when the CLONE finishes, not when PRs sync. A repo therefore renders as "synced" in the client's repo switcher (`last_polled_at ? "synced" : "not synced"`) having never fetched a single PR — misleading when diagnosing "why are there no PRs". Evidence: `server/src/modules/repos/repository.ts:73`, `client/src/components/app-shell/helpers.ts:12`.

## Codebase Patterns

- **2026-06-14** — Shared contracts (`@devdigest/shared`) are vendored as TWO hand-maintained copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — resolved by tsconfig path alias, NOT auto-synced. Adding a field means editing both in lock-step; the only diffs between copies are comments. Evidence: `server/src/vendor/shared/contracts/trace.ts`, `platform.ts`.
- **2026-06-14** — PR-list per-PR aggregates (score, cost) are computed ON READ in `GET /repos/:id/pulls` via one `inArray` query + JS grouping, never denormalized onto `pull_requests`. "Latest review batch" cost has no batch id in the schema — approximated by summing `agent_runs.cost_usd` within a 120s window of the PR's newest priced run. Evidence: `server/src/modules/pulls/routes.ts`.
- **2026-06-14** — `completeAgentRun`'s `values` shape is declared in TWO places that must match: the repo fn (`repository/run.repo.ts`) AND the interface wrapper (`repository.ts:151`). Adding a field (e.g. `costUsd`) needs both or typecheck fails.

## Tool & Library Notes

- **2026-06-14** — New DB columns: edit `db/schema/*.ts`, then `npm run db:generate` (drizzle-kit) auto-generates `00NN_*.sql` (e.g. `0010_solid_baron_zemo.sql` = `ALTER TABLE … ADD COLUMN`). Never hand-write migration SQL; apply with `npm run db:migrate`.

## Recurring Errors & Fixes

- **2026-06-14** — Adding a required field to a Zod contract (`RunStats.cost_usd`) breaks the inline fixture in `server/test/contracts.test.ts` (RunTrace parse). Update the `stats: {…}` fixture in the same change. Evidence: `server/test/contracts.test.ts:160`.
- **2026-08-02** — `./scripts/dev.sh` dies on a fresh clone with pnpm 11: `pnpm install` exits 1 on `ERR_PNPM_IGNORED_BUILDS` (esbuild/sharp/ssh2 postinstalls), and the script runs under `set -e`. Worse, pnpm's pre-run deps check re-runs `install` before EVERY script, so `db:migrate` and `dev` stay blocked even once `node_modules` exists. Fix: pnpm auto-generates `server/pnpm-workspace.yaml` and `client/pnpm-workspace.yaml` with `allowBuilds:` placeholders reading "set this to true or false" — set them to `true` and re-install. Those files are untracked, so each clone hits this fresh. Evidence: `scripts/dev.sh:13,73`.
- **2026-08-02** — GitHub `pulls.list` returning 404 for a repo you own, with a token that passes `POST /settings/test-connection` ("Connected as @you"), means the fine-grained PAT isn't scoped to that repository (or lacks Pull requests: Read) — GitHub returns 404 rather than 403 to avoid confirming a private repo exists. Discriminate with `GET /repos/:owner/:name`: 404 → repo not in the PAT's selected repositories; 200 + pulls 404 → missing the Pull requests permission. Evidence: `server/src/adapters/github/octokit.ts:36`.

## Session Notes

### 2026-06-14
- Re-introduced per-run cost (USD) end-to-end (lesson reversing the earlier removal in `d45ab0d`/`58c6ac7`): `cost_usd` column on `agent_runs` (migration 0010), captured in `run-executor` (was discarding `outcome.costUsd`), surfaced in `RunSummary`/`RunStats`/`PrMeta`.
- Decision: PR-list COST = sum of the latest review batch via a 120s window heuristic (no batch id in schema). Cost persisted (accurate `outcome.costUsd`), not recomputed; historical runs → null → "—".

### 2026-08-02
- Fixed `repos.default_branch` silently staying `'main'`: the column has that default, `RepoRepository.insert()` never sets it, and the list-PRs payload doesn't carry it — so a repo whose upstream default is `develop` reviewed against the wrong base.
- Decision: resolve it from the clone's own `origin/HEAD` (new `GitClient.defaultBranch()`, `git symbolic-ref --short refs/remotes/origin/HEAD`) rather than `repos.get`. Reading it locally keeps working when the PAT can't reach the REST API — exactly the case that surfaced the bug. `null` leaves the stored value alone instead of clobbering it back to the default.
- Note: the client's vendored `GitClient` copy was deliberately NOT updated — it already omits the server-only `sync`/`diffNameOnly` and `client/src` never imports `GitClient`. This is a partial exception to the lock-step rule recorded above under Codebase Patterns.

## Open Questions

- **2026-06-14** — PR-list "latest review batch" uses a 120s `ranAt` window as a proxy for a review session. If a real review-session / batch id is ever added to the schema, swap the window for exact grouping in `pulls/routes.ts`.
