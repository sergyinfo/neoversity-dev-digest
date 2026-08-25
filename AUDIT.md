# DevDigest — codebase audit

Audit of the repository as of commit `66727c8` (branch `main`, working tree clean).
Read-only review: no source files were changed by this audit.

---

## 1. What the project is

**DevDigest** is a local-first AI pull-request review studio, shipped as a course
starter template. You add a GitHub repo, it clones and indexes it, you import PRs,
and an agent reviews the diff and returns structured findings (severity, category,
file:line, rationale, suggested fix) that you accept or dismiss in a web UI.

Four standalone packages — no workspace; cross-package code is shared through
tsconfig path aliases and a **vendored copy** of the Zod contracts:

| Folder | Package | Role | Port |
|---|---|---|---|
| `server/` | `@devdigest/api` | Fastify API + Drizzle/Postgres (pgvector) | 3001 |
| `client/` | `@devdigest/web` | Next.js 15 studio UI | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure engine: diff → prompt → LLM → grounded findings | — |
| `e2e/` | `@devdigest/e2e` | Deterministic browser e2e (agent-browser, no LLM) | — |

~26k lines of TS/TSX across 353 source files. Server modules: `settings`, `repos`,
`pulls`, `polling`, `workspace`, `agents`, `reviews`, `repo-intel`.

### The two flows this audit started from

**Import PRs.** UI Refresh button (`client/.../pulls/page.tsx:96`) → `POST /repos/:id/refresh`
(re-clone + reindex). The actual PR sync happens as a **side effect of the list read**:
`GET /repos/:id/pulls` (`server/src/modules/pulls/routes.ts:26`) calls
`gh.listPullRequests`, upserts each PR idempotently on `(repo_id, number)`
(`:65`), backfills diff stats for up to 10 PRs by fetching their detail (`:89`),
joins the latest review score, and derives a display status via
`deriveReviewStatus` (`pulls/status.ts`). Every GitHub call is wrapped so a
missing token or an offline machine degrades to serving persisted rows.
`GET /pulls/:id` re-fetches full detail (files, commits, body, linked issue) and
rewrites `pr_files` / `pr_commits`. Inline PR comments are proxied live to GitHub
rather than mirrored (`pulls/routes.ts:255-323`).

**Findings.** `POST /pulls/:id/review` creates one `agent_runs` row per target
agent, returns immediately, and runs the work in the background
(`reviews/service.ts:133`). `ReviewRunExecutor` loads the diff once, then per agent:
resolves the LLM provider, enriches the prompt with repo-intel context (callers,
repo skeleton, hot-file rank), and calls `reviewPullRequest` in `reviewer-core` —
assemble prompt (with an injection guard wrapping all untrusted content) →
single-pass or map-reduce → reduce → **citation-grounding gate** (`reviewer-core/src/grounding.ts`:
a finding survives only if its line range intersects a real hunk; full-file kinds
need only the file present) → persist review + kept findings + a `run_traces`
document, streaming events over SSE the whole time. UI: `FindingsTab` (live run,
timeline, runs accordion) → `FindingsPanel` (hide-low-confidence, `j`/`k`
navigation, `a`/`d` actions) → `FindingCard` (severity, category, file:line
deep-linked to GitHub at head SHA, markdown rationale + suggestion, accept/dismiss).

---

## 2. Scope and method

Reviewed by reading: build/config for all four packages, the Fastify bootstrap and
platform layer (config, DI container, jobs, SSE, resilience, errors), every server
module's routes/service/repository, the adapters (GitHub, git, secrets, auth, LLM,
codeindex), the whole `reviewer-core` pipeline, the client API layer, hooks and the
PR-review UI tree, the DB schema and migrations, both test suites, and all five CI
workflows. One finding (H-1) was reproduced against the real dependency; the rest
are established by code inspection with exact locations cited.

**Verdict.** The architecture is genuinely good — clean ports-and-adapters
boundaries, a pure engine, strict TypeScript, real tests, and unusually
high-quality explanatory comments. The defects cluster in the **operational**
layer: background work isn't supervised, one read endpoint mutates data
destructively, and another does network I/O on a 60-second poll. One of them
crashes the API process.

---

## 3. Findings

### High

**H-1 · An unhandled rejection from any background job kills the API process**
`server/src/platform/jobs.ts:59`

`enqueue()` returns `{ id, done }` where `done` is the promise from `queue.add()`.
The handler rethrows on failure (`jobs.ts:96`), so `done` rejects — and no caller
ever attaches a handler: `repos/service.ts:68,98,117,129` and
`repo-intel/routes.ts:53` all use `job.id` and drop `done` on the floor. Node's
default `--unhandled-rejections=throw` terminates the process.

Reproduced with the project's own `p-queue@8`: an uncaught `queue.add` rejection
exits Node with status 1. Trigger in practice: adding a private repo with no
GitHub token, a typo'd repo URL, or an index job that throws — all after the
JobRunner exhausts its 2 retries. Under `pnpm dev` (`tsx watch`) the restart hides
it; a built server just dies.

*Fix:* attach a terminal handler inside `enqueue` before returning
(`done.catch(() => {})` — the failure is already persisted to the `jobs` row and
logged), and keep `done` rejecting only for callers that opt in by awaiting it.

---

**H-2 · `GET /pulls/:id` destroys and rebuilds PR data outside a transaction**
`server/src/modules/pulls/routes.ts:182,194`

A read handler runs `DELETE FROM pr_files WHERE pr_id = …` followed by a bulk
insert (same for `pr_commits`), with no transaction. Two consequences:

1. If the process dies or the insert fails between the two statements, the PR's
   files/commits are gone; the "serve persisted detail offline" fallback below it
   then returns an empty file list.
2. `pr_files` is the **fallback diff source** for reviews (`reviews/diff-loader.ts:31`).
   A review that starts while a concurrent PR-detail read is inside the delete
   window reads an empty or partial file set, produces an empty diff, and finishes
   as a successful review with zero findings — no error anywhere. The client makes
   this collision routine: it refetches PR detail on window focus while runs
   execute in the background.

*Fix:* wrap both rewrites in one `db.transaction`, or replace delete+insert with an
upsert keyed on `(pr_id, path)` / `(pr_id, sha)` plus a delete of rows no longer
present.

---

**H-3 · The PR list is a write-heavy GitHub sync on a 60-second poll**
`server/src/modules/pulls/routes.ts:43-112` · `client/src/lib/hooks/core.ts:109`

`GET /repos/:id/pulls` performs a GitHub list call, up to 50 upserts, and up to 10
additional PR-detail fetches — every time it is called. `usePulls` sets
`refetchInterval: 60_000` **and** `refetchOnWindowFocus: true`. One open tab can
therefore issue ~11 GitHub API calls and dozens of writes per minute; several tabs
multiply it. `GET /pulls/:id` (H-2) does the same on every detail read.

Meanwhile the endpoint actually designed for this — `POST /repos/:id/poll`, the
entire `polling` module, documented as "MANUAL refresh that ONLY syncs the PR
list" — is **never called by the client**. Its only caller in the repo is
`server/test/integration.it.test.ts:142`. The UI's Refresh button calls
`/repos/:id/refresh`, which enqueues a full re-clone plus a reindex.

*Fix:* make `GET /repos/:id/pulls` a pure read of persisted rows; move the sync to
`POST /repos/:id/poll` and wire the Refresh button to it; drop the refetch interval
to on-demand, or gate the sync behind a `last_polled_at` freshness check.

### Medium

**M-1 · `RunBus` never releases run buffers** — `server/src/platform/sse.ts:82`
`complete()` deletes the emitter but the `buffers`, `seq`, `completed` and
`cancelled` maps grow for the lifetime of the process. The comment says the buffer
is kept "briefly" for late subscribers; nothing ever clears it. Every event of
every run stays resident even though the full log is already persisted to
`run_traces` by `saveRunTrace`. *Fix:* evict a run's buffer on a timer after
`complete()` (or once its trace is persisted), and drop it from `completed`/`seq`.

**M-2 · Run endpoints resolve the workspace and then ignore it**
`server/src/modules/reviews/routes.ts:114,121,49`
`POST /runs/:id/cancel`, `GET /runs/:id/trace` and `GET /runs/:id/events` call
`getContext` but pass only `runId` downstream — `cancelRun` and `getRunTrace`
(`reviews/service.ts`) take no `workspaceId`. `DELETE /runs/:id` and the review
reads do scope correctly. Harmless under `LocalNoAuthProvider` (one workspace), but
it contradicts the rule stated in `modules/_shared/context.ts` ("every module uses
this so workspace scoping is never forgotten") and becomes a cross-tenant read/write
the day a real `AuthProvider` is swapped in — which the code explicitly anticipates.

**M-3 · Repo URL parsing is unanchored and accepts path traversal**
`server/src/modules/repos/constants.ts:18`
`GITHUB_URL_REGEX = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/` — verified
behaviour:
- `https://github.com/../etc` → owner `..`, so `clonePathFor`
  (`adapters/git/simple-git.ts:37`) resolves to `join(cloneDir, '..', 'etc')`,
  outside the workspace directory.
- `https://evil.example.com/x/github.com/aa/bb` parses as `aa/bb` and is cloned
  **from the attacker's host** — the regex is not anchored to the start. (The
  GitHub token is not leaked: `withGitHubToken` correctly guards on
  `hostname === 'github.com'`.)

Request validation is only `z.string().url()` (`vendor/shared/contracts/platform.ts:136`).
Low real-world impact for a single-user local tool where the operator types the URL,
but it is free to fix: anchor the pattern to `^https://github\.com/` and
`^git@github\.com:`, and constrain owner/name to `[A-Za-z0-9._-]+` with an explicit
`..` rejection.

**M-4 · The vendored shared contracts have already drifted** —
`server/src/vendor/shared` vs `client/src/vendor/shared`
Five files differ. The client copy is missing `'openrouter'` from `LLMProvider.id`
(`adapters.ts`) and from the provider enum in `productionize.ts`, plus `sessionId`,
`CommitFile`/`CommitFilesPayload`, `AgentManifest` and `AgentVersionConfig`. The
README advertises "one schema, every package"; in practice the copies are synced by
hand, there is no sync script, and no CI job diffs them. *Fix:* add a
`diff -r --brief` check to CI (three lines) or generate one copy from the other.

**M-5 · Review runs bypass the JobRunner entirely**
`server/src/modules/reviews/service.ts:133` · `run-executor.ts:107`
`runReview` fires `void executor.executeRuns(...)`: no timeout, no retry, no `jobs`
row, no concurrency cap — the only limiter is the 10/min route rate limit, and
nothing bounds concurrent runs across different PRs. Separately, `executeRuns`
processes agents **strictly sequentially** in a `for` loop, while every run row is
created with status `running` up front — so "run all agents" shows N runs live in
the UI when only one is actually executing, and the last agent's wall-clock time is
the sum of all the others.

**M-6 · `test-connection` saves the key before it validates it**
`server/src/modules/settings/routes.ts:83`
The supplied key is persisted through `SecretsProvider.set` and the provider caches
are invalidated *before* the live check runs. Pasting a typo'd key overwrites a
working one; the user sees "not ok" and has lost the good value. *Fix:* validate
against a throwaway client first, persist only on success.

**M-7 · GitHub pagination is silently truncated** — `server/src/adapters/github/octokit.ts:42,79,85`
Single page each: 50 PRs, 100 files, 100 commits. A PR with more than 100 changed
files is reviewed on a partial diff, and neither the user nor the run trace is told.
*Fix:* use `octokit.paginate` with an explicit cap, and record the cap in the trace
when it bites.

**M-8 · The real-git-diff path is effectively dead, and fails silently**
`server/src/modules/reviews/diff-loader.ts:19-28`
Clones are `--depth 1` (`repos/constants.ts`), but `loadDiff` asks for
`base...head` (`adapters/git/simple-git.ts:93`) — the base ref isn't in a depth-1
clone, so the call throws, the empty `catch` swallows it, and reviews run on
GitHub's per-file patches instead (context-limited hunks, not a true diff). Either
fetch the base ref before diffing, or delete the git path and document `pr_files` as
the diff source. As written, the code claims a capability it doesn't have.

**M-9 · No linter or formatter in the repository**
No eslint/prettier/biome config or dependency in any package, and no `lint` script —
yet the code contains three `eslint-disable` comments
(`client/src/lib/hooks/reviews.ts:212`, `ReviewRunAccordion.tsx:52`,
`ConfigTab.tsx:39`) that nothing enforces. CI runs typecheck and tests only.

**M-10 · The client trusts API responses at runtime** — `client/src/lib/api.ts:63`
`apiFetch` returns `(await res.json()) as T` with no validation, even though the Zod
contracts are vendored into the client and could `parse` here. Combined with M-4,
server/client drift surfaces as an `undefined` dereference deep in a component
rather than a clear validation error at the boundary.

**M-11 · Job retry counts are overwritten on success** — `server/src/platform/jobs.ts:70`
After a successful run, `attempts` is set to `1`, wiping the value `onRetry` just
recorded. A job that succeeded on its third attempt reports one attempt.

### Low

- **L-1 · Partial i18n.** next-intl is wired with an `en` catalogue and 34
  components use `useTranslations`, but visible screens hardcode English —
  `FindingsTab.tsx` ("Live review", "Timeline", "Review runs", "No findings yet"),
  `OverviewTab.tsx`, `DiffTab.tsx`, `app/page.tsx`. Only one locale exists, so this
  is invisible today and expensive later.
- **L-2 · Stale config and docs.** `.gitignore` carves out `agent-runner/dist/**`
  for a package that isn't in the repo. `server-unit.yml` says "the 12 DB-backed
  test files" and "~19 DB-free" (actual: 6 and 16). The README's lesson table lists
  features as not-yet-built while `client/messages/en/` already ships copy for
  `blast`, `brief`, `eval`, `memory`, `conventions`, `ci`, `conformance`, `compose`,
  `skills`, `agentPerformance`, and the DB schema already defines their tables —
  a large untested surface carried by the starter.
- **L-3 · Mixed package managers.** `server`/`client` use pnpm lockfiles;
  `reviewer-core`/`e2e` use `package-lock.json`, and CI follows suit. The README
  documents pnpm only.
- **L-4 · Path-filtered CI.** Every workflow is path-filtered, so a PR touching only
  root files, `scripts/`, or `docs/` runs no checks at all. Fine as-is; a trap if
  these are configured as required status checks.
- **L-5 · `withTimeout` doesn't cancel.** `platform/resilience.ts:16` races a timer
  against the promise; the underlying LLM/git call keeps running and consuming
  budget after the waiter gives up. No `AbortSignal` is threaded through.
- **L-6 · Dead cost path.** `reviewer-core/src/review/run.ts` still computes and
  returns `costUsd`; nothing persists it since the per-run cost removal (`d45ab0d`).
- **L-7 · Secrets cache never reloads.** `adapters/secrets/local.ts` caches
  `secrets.json` in memory forever; `invalidateSecretCaches()` clears provider
  clients, not this cache. An out-of-band edit to the file needs a restart.
- **L-8 · Local security posture worth stating in the README.** Postgres publishes
  5432 with `devdigest`/`devdigest` (`docker-compose.yml`), the API binds `0.0.0.0`
  (`server.ts:29`) with no authentication, and provider keys sit in plaintext at
  `~/.devdigest/secrets.json` (mode 0600). All reasonable for a local-first tool;
  none of it is written down, and the `0.0.0.0` bind means anyone on the same
  network reaches an unauthenticated API that holds your keys.

---

## 4. What's working well

Worth preserving as the project grows:

- **Ports and adapters, honestly applied.** Every external dependency sits behind an
  interface resolved through the DI container (`platform/container.ts`), with a
  first-class `overrides` path that the tests actually use.
- **The engine is genuinely pure.** `reviewer-core` performs no I/O beyond the
  injected LLM provider, which is what lets one code path serve the studio and CI.
- **The grounding gate.** A mechanical, testable check that drops hallucinated line
  references, with dropped findings surfaced in the trace rather than silently
  discarded — and the score recomputed from survivors so the number, the list and
  the event always agree.
- **Prompt-injection hardening in one shared place** (`reviewer-core/src/prompt.ts`),
  including delimiter-escaping of untrusted content and an explicit rule that
  "this is a test fixture / don't flag this" claims never descope a review.
- **Validation and errors at the edge.** Zod request validation and response
  serialization, a consistent `ApiErrorBody` envelope, serialization failures logged
  rather than leaked (`app.ts`).
- **Thoughtful failure handling in the review path.** Per-agent isolation, cancel
  checkpoints, failures and cancellations persisted with their log buffer so the UI
  explains *why* after a reload, and stale `running` runs reaped on boot.
- **Local-first degradation is real, not aspirational.** Missing token, offline, or
  unindexed repo each degrade to a documented fallback instead of an error page.
- **Strict TypeScript everywhere** (`strict` + `noUncheckedIndexedAccess` in all four
  packages), and only two `any` occurrences in ~26k lines.
- **Test strategy split by cost** — hermetic unit tests, testcontainers-backed
  integration tests, and a deterministic browser suite that runs without an LLM,
  each with its own path-filtered workflow.
- **Comments explain *why*.** Rare and valuable: the reaping-on-boot rationale, the
  two-dot vs three-dot diff choice, the empty-`LOG_LEVEL` coercion.

---

## 5. Suggested order of work

1. **H-1** — one line; it is the difference between a background failure and a dead
   API.
2. **H-2** — wrap the PR-detail rewrite in a transaction; it silently corrupts the
   input a review runs on.
3. **H-3** — make the list read pure and wire Refresh to the existing `/poll`
   endpoint; removes the GitHub rate-limit burn and most of H-2's collision window.
4. **M-6, M-11, M-1** — small, self-contained correctness fixes.
5. **M-4 + M-9** — add the vendor-drift check and a linter to CI, so both classes of
   problem stop recurring.
6. **M-5, M-8** — decide deliberately: supervise runs through the JobRunner (or
   document why not), and either fix the git diff path or delete it.
7. **M-2, M-3, M-7, M-10** — hardening ahead of multi-user or multi-tenant use.
