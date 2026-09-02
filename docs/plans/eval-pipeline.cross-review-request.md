# Cross-review request: Eval Pipeline (L06)

You are reviewing an implementation plan against the specification it claims to satisfy.

---

## PART 1 — The specification (the agreed WHAT and WHY)

# Spec: Eval Pipeline   |   Spec ID: SPEC-2026-09-02-eval-pipeline   |   Status: approved

Scope: cross-module (`server`, `client`, `reviewer-core`). Lives in the root `specs/`
per `specs/README.md`.

## Problem & why

A reviewer agent is a prompt, a model and a set of linked skills. Every one of those is
edited by hand, and today nothing tells you what an edit did. Change the system prompt and
the only feedback is the next PR someone happens to open — by which point the regression is
already in front of a developer, and there is no way to say whether the agent got better or
worse, only that it produced *different* text.

Lesson 6's harness answered this for skills, off to the side, against synthetic fixtures.
The same question needs answering **inside the product**, against **real** data: the
`accepted` / `dismissed` decisions already recorded on findings in L01–L05 are a labelled
dataset. An accepted finding is a thing the agent *should* report; a dismissed one is noise
it *should not*. Nobody has to invent test cases — they already exist, one click away from
the finding that produced them.

The measurement itself must be boring and free. On the harness a judge model was needed
because "explained the reason" cannot be checked with a substring. Here an expectation is a
`file` and a line range, and a match is arithmetic. **No LLM participates in scoring.**

## Goals / Non-goals

**Goals**

- Turn any finding into an eval case in one click, with the expectation type derived from
  the decision already made on it (`accepted` → must-find, `dismissed` → must-not-flag).
- Run an agent over its whole case set with **fixed inputs**, so two runs of two agent
  versions are comparable.
- Score deterministically: `recall`, `precision`, `citation_accuracy`, computed in code.
- Show the numbers where the agent is edited (Evals tab) and across agents (Eval Dashboard).
- Compare two runs side by side, including what changed in the system prompt between them.

**Non-goals**

- No LLM-as-judge anywhere in scoring. If a check cannot be expressed as file+lines, it is
  out of scope for this pipeline.
- No new schema. `eval_cases` and `eval_runs` are given; this spec adds no columns.
- Not a replacement for `skill-evals/`, which measures a *skill's delta* via A/B arms. This
  measures an *agent's absolute quality* against a fixed labelled set. Both stay.
- No CI gate in this iteration. `verify:l06` proves the pipeline works locally; blocking a
  merge on eval metrics is a later decision.

## User stories

1. As a reviewer, when I accept a finding I can press **Turn into eval case** and the agent
   is from then on required to keep finding it.
2. As a reviewer, when I dismiss a finding as noise I can do the same, and the agent is from
   then on penalised for reporting it again.
3. As an agent author, I open the agent's **Evals** tab and see every case, which passed, and
   the three metrics.
4. As an agent author, I press **Run eval** and get a fresh run over the whole set.
5. As an agent author, I edit the system prompt, run again, and **compare the two runs**:
   metric deltas plus the prompt diff that explains them.
6. As a team lead, I open **Eval Dashboard** and see every agent's latest numbers and the
   most recent runs across all of them.

## Acceptance criteria (EARS)

### Case creation

- **WHEN** a user presses *Turn into eval case* on a finding whose status is `accepted`,
  the system **SHALL** create an `eval_cases` row whose `expected_output` is a `must_find`
  expectation carrying that finding's `file`, `start_line`, `end_line`, `severity` and
  `category`.
- **WHEN** the finding's status is `dismissed`, the system **SHALL** create a
  `must_not_flag` expectation carrying `file` and the line range only.
- **WHEN** the finding has neither status, the button **SHALL** be disabled, and the reason
  **SHALL** be stated in its tooltip — an unlabelled finding is not a data point.
- The system **SHALL** store, at creation time, the diff the finding was made against in
  `input_diff`, so the case is replayable after the branch is gone.
- **IF** a case already exists for that finding, the system **SHALL** return the existing
  case rather than creating a duplicate.

### Running

- **WHEN** `POST /agents/:id/eval-runs` is called, the system **SHALL** run the agent over
  every case owned by that agent, using **only** the case's stored `input_diff`,
  `input_files` and `input_meta` as review input.
- The system **SHALL NOT** read the live repository, the PR, or any index during an eval
  run. Two runs of the same case differ only by the agent, never by the input.
- The system **SHALL** write one `eval_runs` row per case, all sharing one `ran_at` and one
  `batch_id`.
- Each row's `actual_output` **SHALL** carry the envelope described under *Contracts*,
  including a snapshot of the agent's `system_prompt`, `model` and linked skill slugs, so a
  run remains interpretable after the agent is edited.

### Scoring — deterministic

- The system **SHALL** compute all metrics in code, with **zero** model calls. A run whose
  scoring path issues an LLM request is a defect.
- A produced finding **SHALL** be considered to match an expectation **WHEN** the `file`
  strings are equal **AND** the line ranges overlap (`a.start ≤ b.end AND b.start ≤ a.end`).
- `recall` **SHALL** be `matched must_find expectations / total must_find expectations`,
  and **SHALL** be `1` when the set contains no `must_find` expectation.
- `precision` **SHALL** be `TP / (TP + FP)` where `TP` is produced findings matching a
  `must_find` expectation and `FP` is produced findings matching a `must_not_flag`
  expectation, and **SHALL** be `1` when `TP + FP = 0`. Findings matching neither are
  ignored: the dataset makes no claim about them, and counting them would punish the agent
  for correctly reporting something nobody has labelled yet.
- `citation_accuracy` **SHALL** be the share of produced findings that survive
  `groundFindings()` from `reviewer-core` — the same gate the product already applies —
  and **SHALL** be `1` when the agent produced no findings.
- A case **SHALL** be marked `pass` **WHEN** every `must_find` expectation matched **AND**
  no `must_not_flag` expectation matched.

### UI

- The **Evals** tab in the agent editor **SHALL** list every case with its last result, and
  **SHALL** show the three metrics with their delta against the previous run.
- The **Eval Dashboard** page **SHALL** appear in the left sidebar under *Skills Lab*, list
  every agent with its latest metrics, and list recent runs across all agents.
- Selecting exactly two runs **SHALL** enable *Compare*; the comparison **SHALL** show each
  metric as `old → new` with the delta, and a diff of the two runs' stored system prompts.
- **WHEN** fewer or more than two runs are selected, *Compare* **SHALL** be disabled.

### Experiment (the point of the exercise)

- The set **SHALL** contain at least 8 cases.
- Editing the system prompt and re-running **SHALL** move `recall` and/or `precision`
  visibly between the two runs.
- Deliberately degrading the prompt — instructing the agent to report style nits — **SHALL**
  lower `precision`, because those findings land on `must_not_flag` expectations.

### Verification

- `pnpm verify:l06` **SHALL** exit non-zero when any of the following is false: the two
  tables exist; a case can be created from each decision type; a run produces all three
  metrics; the scoring path makes no network call; the set holds ≥ 8 cases.

## Edge cases

- **Case set empty** — the run route returns `422` with a message naming the agent, rather
  than a run with `NaN` metrics. Division by zero is decided by the rules above, not by
  floating point.
- **Agent produces zero findings** — `recall` is 0 (unless there are no must-find
  expectations), `precision` is 1 by the `TP+FP = 0` rule, `citation_accuracy` is 1. This is
  correct and worth stating: an agent that says nothing is not precise, it is silent, and
  only `recall` is entitled to punish it.
- **Finding deleted after the case was made** — the case survives. It carries its own diff
  and expectation and never dereferences the finding again.
- **Same file, adjacent but non-overlapping lines** — not a match. The overlap rule is
  strict; a finding two lines away is a different finding.
- **Renamed file between the case's diff and the agent's output** — not a match. Cases are
  snapshots, and a rename makes the old case stale rather than silently passing.
- **Two expectations on the same lines** — each produced finding is matched to at most one
  expectation, greedily and in file order, so one finding cannot satisfy two must-finds.
- **Run interrupted mid-set** — rows already written stay, and the batch is reported as
  partial via `traces_total` < case count rather than being silently averaged.

## Non-functional

- Scoring is pure and synchronous: no I/O, no clock, no randomness. It is unit-testable
  without a database, and the tests are the cheapest part of the suite.
- A full run is N model calls for N cases — the same cost as N reviews. The route runs
  cases sequentially and reports `cost_usd` per row so a run's price is visible before it
  is repeated.
- Metrics are stored per row; the dashboard aggregates on read. No derived table, nothing
  to keep in sync.

## Cross-module interactions

- `reviewer-core` — the review engine executes each case; `groundFindings()` supplies
  `citation_accuracy`. No change to the engine, and no I/O added to it: the diff arrives as
  a string, as it already does.
- `server` — a new `evals` module (routes → service → repository), registered statically in
  `server/src/modules/index.ts` per the repo convention.
- `client` — the Evals tab inside the agent editor, and a new Eval Dashboard route, both
  reaching the API through `src/lib/api.ts` only.
- `server/src/vendor/shared/` is **not** touched. `EvalCaseInput`, `EvalRunRecord`,
  `EvalRunResult`, `EvalDashboard` and `EvalRun` are consumed exactly as given.

## Contracts

`expected_output` is `z.unknown()` in the given contract, so this spec fixes its shape
inside the module:

```ts
type EvalExpectation =
  | { kind: 'must_find';     file: string; start_line: number; end_line: number;
      severity?: Severity; category?: FindingCategory; title?: string }
  | { kind: 'must_not_flag'; file: string; start_line: number; end_line: number };

// eval_cases.expected_output
type ExpectedOutput = { expectations: EvalExpectation[] };
```

`actual_output` carries an envelope, which is what makes a run self-describing and
comparable without a schema change:

```ts
type ActualOutput = {
  batch_id: string;              // groups the rows of one run of the whole set
  findings: Finding[];           // what the agent produced, as-is
  grounded_ids: string[];        // the subset that survived groundFindings()
  matches: { expectation_index: number; finding_id: string | null }[];
  agent: { system_prompt: string; model: string; skills: string[] };
};
```

Routes:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/findings/:id/eval-case` | one-click case creation from a finding |
| `GET` | `/agents/:id/eval-cases` | the agent's set |
| `DELETE` | `/eval-cases/:id` | remove a case |
| `POST` | `/agents/:id/eval-runs` | run the whole set, return `EvalRunResult[]` |
| `GET` | `/agents/:id/eval-dashboard` | `EvalDashboard` for one agent |
| `GET` | `/eval-dashboard` | workspace-wide: every agent + recent runs |

All routes are workspace-scoped, matching the rest of the API.

## Untrusted inputs

`input_diff` is attacker-controlled content from a pull request. It is replayed into a model
prompt on every run, so it stays wrapped by the existing `wrapUntrusted()` guard exactly as
a live review wraps it. An eval case is a *stored* prompt injection vector if this is
skipped — worse than the live path, because it is replayed on every future run.

`expected_output` is written by the server from a finding the server itself produced; it is
never accepted verbatim from the client.

## Open questions

1. **Run-level identity.** `batch_id` inside `actual_output` groups a run without a
   migration, but it cannot be indexed. If comparison over hundreds of runs gets slow, the
   honest fix is a `batch_id` column, not a cleverer query.
2. **Precision when nothing is labelled.** The `TP + FP = 0 → 1` rule means an agent that
   only reports unlabelled findings scores a perfect precision. That is deliberate for now —
   the alternative punishes discovery — but it makes `precision` meaningless until the set
   has dismissed cases in it. The dashboard should say so when `FP + TP` is 0 rather than
   printing `100%`.
3. **Skill linkage in the snapshot.** Storing skill *slugs* records which skills were
   linked, not what they said. Two runs a week apart can show an identical snapshot and
   still differ because a skill body changed underneath. Recording a content hash per skill
   would close that; whether it is worth the bytes is undecided.

---

## PART 2 — The implementation plan

# Implementation Plan: Eval Pipeline (L06)

> Spec: `specs/eval-pipeline.md` (SPEC-2026-09-02-eval-pipeline, Status: approved).
>
> **Execution mode agreed: multi-agent run** (tracks T0–T5 with the barriers below). Requires `--max-agents ≥ 6`.

## Requirements review

### Already built — do not rebuild any of this

| # | Requirement (as given) | Verdict | Evidence |
|---|---|---|---|
| R1 | "Tables `eval_cases` and `eval_runs` — schema … GIVEN" | **already built** | `server/src/db/schema/eval.ts:7-36`, registered via `server/src/db/schema.ts`. **The migration also already exists**: `server/src/db/migrations/0000_init.sql:116-140` creates both tables, `:376-377` adds the FKs. **No `db:generate`, no `db:migrate`, no new migration file anywhere in this plan.** |
| R2 | "Zod contracts are GIVEN" | **already built** | `server/src/vendor/shared/contracts/eval-ci.ts` (`EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard`); `contracts/knowledge.ts:49-84` (`EvalPerTrace`, `EvalRun`, `EvalOwnerKind`, `EvalCase`). Both vendored copies verified byte-identical (`diff -rq` → clean). **`vendor/shared` is never entered.** |
| R3 | i18n copy for the whole feature | **already built** | `client/messages/en/eval.json` ships `dashboard.*` (incl. `metricTrend`, `recentRuns`, `runEval`, `running`, table headers), `caseEditor.*`, `evalsTab.*`, `page.*` — with **zero readers today**. `client/messages/en/agents.json:50` already has `editor.tabs.evals`. `client/messages/en/shell.json` already has `nav.eval: "Eval Dashboard"`. This is the exact trap `client/INSIGHTS.md` records for `blast.json` (2026-08-23). **Read these files before writing any string.** |
| R4 | Sidebar routing for the Eval Dashboard | **half built** | `client/src/components/app-shell/helpers.ts:38` already returns `"eval"` for `/eval*`, and `shell.json`'s `nav.eval` (command-palette half) exists. **Only the `NAV` literal in `client/src/vendor/ui/nav.ts` is missing** — one entry in the `SKILLS LAB` group. |
| R5 | UI primitives for metric cards / trend / compare modal | **already built** | `client/src/vendor/ui/charts/{MetricCard,LineChart,Sparkline}.tsx`, `kit/{Modal,Checkbox,Tabs}.tsx`, `icons.tsx:31` `FlaskConical`. `MetricCard(label, value, delta, color, trend, suffix)` is exactly the Evals-tab tile. |
| R6 | `groundFindings()` supplies `citation_accuracy` | **already built, and free** | `reviewer-core/src/review/run.ts:203-214` — `reviewPullRequest` already runs the grounding gate and returns `review.findings` (kept) **plus `dropped[]`**. `citation_accuracy = kept / (kept + dropped)` needs **no second `groundFindings()` call**. **No change to `reviewer-core` at all.** |
| R7 | "`input_diff` stays wrapped by `wrapUntrusted()`" | **already built, if you go through the engine** | `reviewer-core/src/prompt.ts:141` wraps the diff unconditionally inside `assemblePrompt`. Satisfied by calling `reviewPullRequest`; violated only by hand-rolling a prompt — which S13 statically forbids. |

### Conflicting / infeasible as written — all now settled

| # | Requirement | Verdict | Evidence | Settled by |
|---|---|---|---|---|
| R8 | "≥ 8 cases in the set" from the existing accept/dismiss dataset | **was infeasible** | `server/src/db/seed.ts:156-188`: of PR #482's four `pr_files`, **only `src/config.ts` carries a `patch`**; `diffFromPrFiles` (`reviews/diff-loader.ts:32-44`) skips patch-less files. The 10 seeded findings (`seed.ts:214+`) span four files and **none carries `acceptedAt`/`dismissedAt`**. | **BQ-1 = (a)** → S12 |
| R9 | `POST /findings/:id/eval-case` with no body | **was conflicting** | `eval_cases.owner_id` must be an agent, but the seeded review is inserted **without `agentId`** (`seed.ts:200-212`; column nullable at `schema/reviews.ts:18`). | **BQ-2 = (a)** → S1, S4, S12 |
| R10 | `POST /agents/:id/eval-runs` returns `EvalRunResult[]` synchronously | **conflicts with repo precedent, accepted anyway** | The one existing multi-LLM route is fire-and-forget (`reviews/service.ts:226-232`). Fastify sets no `requestTimeout` (`app.ts:49` sets only `bodyLimit`), so a synchronous run completes. | **BQ-5 = (a)** + REC-5 cap/limit → S4, S5 |
| R11 | `EvalRunResult.result` is an `EvalRun` with set-level `traces_*`, emitted per case | **was conflicting** | `contracts/knowledge.ts:58-68` is a set-level aggregate; the spec's "partial via `traces_total` < case count" is also set-level. | **BQ-4 = (a)**: batch is the unit; `traces_*` carry batch-level counts on every row of that batch → S3, S4 |
| R12 | Dashboard "recent runs across all agents" | **was infeasible with the given envelope** | `EvalRunRecord` has no agent field; the spec's `ActualOutput.agent` has no id/name. | **REC-1 accepted** → S1, S4, S10 |

### Ambiguous — all now settled

| # | Requirement | Settled by |
|---|---|---|
| R13 | "diff fragment" (brief) vs "the diff the finding was made against" (spec) | **BQ-3 = (a)**: single-file slice via `sliceDiff` (REC-3) |
| R14 | "A **produced** finding SHALL be considered to match" — pre- or post-grounding? | **BQ-6 = (a)**: post-grounding (`outcome.review.findings`); `citation_accuracy` separately reports the drop |
| R15 | "changing the system prompt visibly moves recall/precision" | **unverifiable as a gate** — non-deterministic. Scoped as a **manual experiment** producing the screenshot; `verify:l06` checks only the five mechanical conditions the spec lists |
| R16 | Screenshot + screencast deliverables | **out of the implementer's scope** — human artifacts, named in Handoff |

### Clear — planned as-is

R17 expectation type follows the decision · R18 disabled button + tooltip for unlabelled findings · R19 idempotent case creation · R20 deterministic scoring, zero model calls · R21 overlap match rule + all seven edge cases · R22 Evals tab · R23 Eval Dashboard page · R24 Compare gated on exactly two selections · R25 `pnpm verify:l06` · R26 all routes workspace-scoped · R27 no live repo/PR/index read during a run.

---

## Goal & scope

Build the in-product regression harness for reviewer agents: turn an accepted or dismissed finding into an eval case in one click, replay an agent over its whole case set from stored inputs only, score `recall` / `precision` / `citation_accuracy` deterministically in code with **zero model calls**, and surface the numbers in an Evals tab, a workspace Eval Dashboard, and a two-run comparison that includes the system-prompt diff. Done means: a new `evals` server module registered statically, client hooks plus three UI surfaces, ≥ 8 seeded cases, one deterministic e2e flow, and `pnpm verify:l06` exiting 0.

**Out of scope — the executing agent must NOT do these:**

- Edit `server/src/vendor/shared/` or `client/src/vendor/shared/`. The contracts are consumed exactly as given.
- Create a migration or add a column. Both tables already exist; `batch_id` and the agent snapshot live inside `actual_output`.
- Change `reviewer-core` in any way (it already grounds, and already wraps the diff as untrusted).
- Call `groundFindings()` a second time — `reviewPullRequest` already returns `kept` and `dropped`.
- Introduce an LLM anywhere in scoring, or any judge model.
- Add a CI gate on eval metrics (spec non-goal).
- Touch `skill-evals/` or `evals/` — separate harnesses with different purposes.
- Add a lint step. There is no linter in this repository.
- Produce the screenshot or screencast (human deliverables).

## Affected packages

| Package | Why it's touched | Risk |
|---|---|---|
| `server/` | New `evals` module (contract, scoring, repository, service, routes), one registry line, seed extension, README API map | Medium — tenancy, envelope shape, the "no model in scoring" invariant |
| `client/` | Hooks, type re-exports, FindingCard button, Evals tab, `/eval` page, compare modal, one `nav.ts` entry | Medium — two documented two-place wiring traps |
| `reviewer-core/` | **None.** Consumed via `reviewPullRequest`, `sliceDiff` | None |
| `e2e/` | One new flow file (REC-7) | Low, but adds a stack-dependent gate |
| repo root | `scripts/verify-l06.sh`, script entries in `server/package.json` + `client/package.json` | Low |

## Constraints in force

- **`server/src/vendor/shared/` is do-not-touch** — source: root `CLAUDE.md`, "Do-not-touch". **Not entered.** Module-local shapes go in `server/src/modules/evals/contract.ts`, the house pattern — precedent `server/src/modules/blast/contract.ts`, `project-context/contract.ts`, and `reviews/routes.ts:155-158`'s own comment ("a request shape for one client, not a contract three packages share").
- **The two vendored copies must stay byte-identical** — source: `server/INSIGHTS.md:23`. `verify:l06` re-asserts `diff -rq`.
- **`server/src/db/migrations/` is do-not-touch and is not entered** — both tables ship in `0000_init.sql:116-140`.
- **ESM `.js` extensions on relative imports** in `server/`, `e2e/` (both `"type": "module"`); **not** in `client/`.
- **Tenancy:** every handler resolves via `getContext(app.container, req)` — source: `server/CLAUDE.md`. Cross-workspace access is a **404, never a 403** (`project-context/routes.ts:44`).
- **`reviewer-core` iron rule: no I/O** — honoured by not touching it.
- **Validation is Zod.** Request-validation failure → **422** `{error:{code:'validation_error',…}}` (`server/src/platform/errors.ts:25-29`); `AppError` carries its own code; fallback 500 `internal_error`.
- **Modules are registered statically** in `server/src/modules/index.ts` — one import + one entry, no autoload.
- **Client contracts come from `@devdigest/shared`, never hand-duplicated** — source: `client/CLAUDE.md`. The module-local envelope the compare modal reads **is** declared locally, following `client/src/lib/hooks/blast.ts` (`client/INSIGHTS.md`, 2026-08-23) — that is not a duplication, since the shape does not exist in shared.
- **Client styling is colocated `styles.ts` objects (`satisfies CSSProperties`) + CSS custom properties — not Tailwind.**
- **`@testing-library/user-event` is not installed** — use `fireEvent` (`client/INSIGHTS.md`, 2026-08-02). This overrides the `react-testing-library` skill's default advice; the repo wins.
- **Server tests live in `server/test/`, not colocated**; `*.it.test.ts` are the Docker/Postgres ones. **Client tests are colocated.**
- **e2e flows are deterministic, call no LLM, and never mutate** — `e2e/README.md:35-36`.
- **`INSIGHTS.md` writes are append-only.**
- **Precedence:** package `INSIGHTS.md` → package `CLAUDE.md` → root `CLAUDE.md` → skill → general practice.
- **Do-not-touch entered:** **none.** If any step finds itself wanting a `vendor/shared` edit or a migration, that is BQ-4 or REC-1 resurfacing — stop and escalate; do not generate.

## Existing scaffolding check

Reuse, do not rebuild:

- **DB**: `evalCases` / `evalRuns` tables *and* their migration.
- **Contracts**: all six eval shapes in `vendor/shared`, byte-identical across copies.
- **i18n**: `eval.json` (dashboard, case editor, evals tab, breadcrumbs), `agents.json:50` `editor.tabs.evals`, `shell.json` `nav.eval`. Nearly every label you need is already written.
- **Nav**: `activeKeyFor` already maps `/eval` → `"eval"`; the command-palette key exists. Only the `nav.ts` literal is missing.
- **UI primitives**: `MetricCard`, `LineChart`, `Sparkline`, `Modal`, `Checkbox`, `Tabs`, `EmptyState`, `Skeleton`, `ErrorState`, `Badge`, `Markdown`, `Icon.FlaskConical`. Note `Button`'s variant prop is **`kind`**, not `variant` (`client/INSIGHTS.md`, 2026-08-17).
- **Diff rendering**: `client/src/components/diff-viewer/` for an input-diff preview; the *prompt* diff in the compare modal is text-vs-text and needs its own small helper.
- **Engine**: `reviewPullRequest`, `sliceDiff`, `groundFindings`, `wrapUntrusted` — all exported from `reviewer-core/src/index.ts`.
- **Server platform**: `getContext`, `IdParams` (uuid-validated), `AppError` / `NotFoundError` / `ValidationError`, `container.llm(provider)`, `container.agentsRepo`, `MockLLMProvider` (`adapters/mocks.ts:59`), `server/test/helpers/pg.ts` (`startPg`, `dockerAvailable`).
- **Diff reconstruction**: `diffFromPrFiles` (`reviews/diff-loader.ts:32-44`) and `parseUnifiedDiff` (`adapters/git/diff-parser.ts`).
- **Verify script templates**: `scripts/verify-l03.sh` (exit status = failure count; every check runs; `DOCKER_HOST`/OrbStack handling at `:41-47`) and `scripts/verify-l04.sh` (`code_only()` comment-stripper, `empty()` helper).
- **e2e**: `e2e/specs/08-project-context.flow.json` is the richest example of the flow JSON convention; `e2e/run.ts` documents the runner contract.

---

## Steps

### S1 — Module-local eval contract
- **Files:** `server/src/modules/evals/contract.ts` (new)
- **Contents:**
  - `EvalExpectation` — discriminated union on `kind`: `must_find` (`file`, `start_line`, `end_line`, optional `severity`, `category`, `title`) | `must_not_flag` (`file`, `start_line`, `end_line`).
  - `ExpectedOutput` = `{ expectations: EvalExpectation[] }`.
  - `ActualOutput` = `{ batch_id, findings, grounded_ids, matches[{expectation_index, finding_id}], agent }` where **`agent = { id, name, system_prompt, model, skills: { id, name, version, content_hash }[] }`** — id/name per **REC-1**, per-skill `content_hash` per **REC-6**. **There is no `slug` column on `skills`** (`server/src/db/schema/skills.ts:5-21`); do not invent one.
  - `CreateEvalCaseBody` = `{ agent_id?: uuid }` (BQ-2a).
  - `RunEvalBody` (empty/tolerant), `EvalBatchSummary` (BQ-4a: `batch_id`, `ran_at`, aggregate metrics, `traces_passed`, `traces_total`, `cost_usd`, `agent` snapshot ref).
  - Zod; `Severity` / `FindingCategory` / `Finding` imported from `@devdigest/shared`; relative imports carry `.js`.
- **Skill:** `zod`, `typescript-expert`
- **Test:** `server/test/evals-contract.test.ts` — round-trips both expectation kinds; rejects an expectation missing `file`; accepts an `ActualOutput` with an empty `findings` array; asserts the `agent` snapshot requires `id`, `name` and a `content_hash` per skill.
- **Depends on:** —
- **Done when:** `pnpm typecheck` passes, the contract test is green, and `git status --porcelain server/src/vendor/shared client/src/vendor/shared` prints nothing.

### S2 — Deterministic scorer (pure, no I/O)
- **Files:** `server/src/modules/evals/scoring.ts` (new)
- **Contents:** `overlaps(a, b)` (`a.start ≤ b.end && b.start ≤ a.end`); `matchFindings(expectations, findings)` — greedy, **each finding matched to at most one expectation**, iterating in file order (spec edge case "two expectations on the same lines"); `score({expectations, findings, keptCount, droppedCount})` returning `{recall, precision, citation_accuracy, pass, matches}`. Division rules exactly as specified: no `must_find` → `recall = 1`; `TP + FP = 0` → `precision = 1` (and the caller is told so, for REC-2's "n/a"); no findings produced → `citation_accuracy = 1`. `pass` = every `must_find` matched **and** no `must_not_flag` matched.
  **This file imports nothing with I/O** — no container, no db, no `node:fs`, no LLM. It is pure and synchronous: no clock, no randomness.
- **Skill:** `typescript-expert`
- **Test:** `server/test/evals-scoring.test.ts` — one named case per spec edge case: empty expectation set; zero findings (recall 0 / precision 1 / citation 1); adjacent-but-non-overlapping lines → no match; renamed file → no match; two expectations on the same lines → one finding satisfies exactly one; a `must_not_flag` hit lowering precision; unmatched findings ignored by precision; `pass` true only under both conditions.
- **Depends on:** S1
- **Done when:** every bullet in spec §Edge cases has a named test, and the module's import list contains no I/O-capable module.

### S3 — Repository (workspace-scoped reads/writes, batch aggregation)
- **Files:** `server/src/modules/evals/repository.ts` (new)
- **Contents:** `listCases(workspaceId, agentId)`; `findCaseByFinding(workspaceId, findingId)` (idempotency key stored in `input_meta`); `insertCase`; `deleteCase`; `insertRun`; **`listBatches(workspaceId, agentId)`** — group `eval_runs` by `actual_output->>'batch_id'`, aggregate the three metrics + pass rate + cost, newest first (BQ-4a); `runsForBatch(workspaceId, batchId)`; `recentRunsForWorkspace(workspaceId)` joining `eval_runs → eval_cases` for `owner_id` and `agents.name`; **`agentSkillsForSnapshot(agentId)`** returning `{ id, name, version, body }` for enabled linked skills in configured order (REC-6 — the existing `getAgentSkillBodies` returns bodies only, `server/src/modules/reviews/repository/skill.repo.ts:17-28`; **do not modify that shared query**, add a sibling here).
  Every query filters on `eval_cases.workspace_id`; `eval_runs` is never reached without joining its case.
- **Skill:** `drizzle-orm-patterns`
- **Test:** covered by S6 — SQL correctness belongs in the integration suite per `TESTING.md`.
- **Depends on:** S1
- **Done when:** no query touches `eval_runs` without the workspace guard via `eval_cases`, and disabled skills are filtered in SQL (matching the guarantee `skill.repo.ts` documents).

### S4 — Service: case creation + synchronous run orchestration
- **Files:** `server/src/modules/evals/service.ts` (new)
- **Contents:**
  - **`createFromFinding(workspaceId, findingId, agentIdFromBody?)`** — load finding → review → PR; 404 on cross-workspace; derive the expectation kind from `acceptedAt` / `dismissedAt` and **422 naming the reason** when neither (AC-3's server half); resolve the owner per **BQ-2a** (`review.agent_id` → body `agent_id` → 422); build `input_diff` as the **single file's slice** — `diffFromPrFiles(prId)` then `sliceDiff(diff, finding.file)` (**BQ-3a / REC-3**); return the existing case unchanged when one exists (AC-5). `expected_output` is written **by the server from the server's own finding row**, never accepted from the client.
  - **`runSet(workspaceId, agentId)`** — 422 naming the agent when the set is empty; **cap at 50 cases** and let the route's rate limit do the rest (**REC-5**); one `batch_id` (`crypto.randomUUID()`) and one `ranAt` for the whole batch; **sequentially** per case call `reviewPullRequest({ systemPrompt, model, diff: parseUnifiedDiff(case.input_diff), llm, skills: bodies })` and **nothing else** — no repo-intel, no project-context, no intent, no PR description, no live `sessionId`, no repository or index read of any kind (AC-7). Score with S2 over **`outcome.review.findings`** (post-grounding, **BQ-6a**), with `citation_accuracy = kept / (kept + dropped)` taken from `outcome.review.findings.length` and `outcome.dropped.length` — **no second `groundFindings()` call**. Build the envelope including the agent snapshot with a **`sha256` content hash per linked skill** (REC-6). Write one `eval_runs` row per case; on a mid-batch throw, **rows already written stay** and the batch reports `traces_total` < case count (spec edge case). Return `EvalRunResult[]` synchronously (**BQ-5a**), with batch-level `traces_passed` / `traces_total` per **BQ-4a**.
  - **`dashboardForAgent` / `dashboardForWorkspace`** producing `EvalDashboard`: `trend` from batches chronologically, `delta` against the previous batch, `alert` carrying the `TP + FP = 0` note (**REC-2**) or null.
- **Skill:** `typescript-expert`, `security` (guardrail: `input_diff` is stored attacker-controlled content replayed on every future run — it must reach the model only through `assemblePrompt`'s `wrapUntrusted`)
- **Test:** `server/test/evals-service.test.ts` (unit, `MockLLMProvider`) — asserts the `reviewPullRequest` input object carries **only** `systemPrompt`, `model`, `diff`, `llm`, `skills`; asserts one shared `batch_id`; asserts empty set → 422 naming the agent; asserts a mid-batch throw leaves earlier rows and a partial `traces_total` (Edge-7); asserts the snapshot carries a stable hash per skill that changes when a skill body changes (REC-6).
- **Depends on:** S2, S3
- **Done when:** a run over a 3-case fixture writes 3 rows sharing one `batch_id`, and the mock LLM recorded **exactly 3 calls** — scoring added none.

### S5 — Routes + registry
- **Files:** `server/src/modules/evals/routes.ts` (new), `server/src/modules/index.ts` (**+1 import line, +1 registry entry**)
- **Contents:** the spec's six routes —
  `POST /findings/:id/eval-case` · `GET /agents/:id/eval-cases` · `DELETE /eval-cases/:id` · `POST /agents/:id/eval-runs` · `GET /agents/:id/eval-dashboard` · `GET /eval-dashboard`
  — **plus `GET /agents/:id/eval-runs`** (batch list), a deliberate addition following **BQ-4a**; call it out in the PR description as an addition to the approved spec's route table.
  `appBase.withTypeProvider<ZodTypeProvider>()`; `IdParams` on every `:id`; `getContext(app.container, req)` in **every** handler; `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` on the run route, matching `reviews/routes.ts:29-31` (REC-5). **No `response:` schema** — no route in this server declares one (`project-context/routes.ts:35-40`), and adding one here would make this module the odd one out.
- **Skill:** `fastify-best-practices`, `zod`
- **Test:** `server/test/evals-routes.test.ts` — 422 envelope shape on a non-uuid `:id`; 404 (not 403) on a cross-workspace agent; the run route's rate-limit config is present.
- **Depends on:** S4
- **Done when:** `modules/index.ts` gained exactly one import and one entry, and the app boots with all seven routes listed.

### S6 — Server integration test (real Postgres)
- **Files:** `server/test/evals.it.test.ts` (new)
- **Contents:** `dockerAvailable()` guard + `startPg` + `seed()` + `buildApp` with `MockLLMProvider`. Create a case from an accepted finding and from a dismissed one; assert the two expectation shapes (AC-1/AC-2); assert `input_diff` is the file slice and non-empty (AC-4); assert re-posting returns the same case id (AC-5); assert an unlabelled finding is a 422 with a reason; delete the source finding and assert the case survives and still lists (Edge-3); run the set and assert three metrics on every row, one shared `batch_id`, batch-level `traces_*`, and correct `pass` semantics; **assert the mock LLM call count equals the case count** (AC-10 — scoring adds zero).
  The test labels its own findings rather than depending on seed content, so it stays green independently of S12.
- **Skill:** `drizzle-orm-patterns`, `fastify-best-practices`
- **Depends on:** S5
- **Done when:** `pnpm exec vitest run .it.test` is green with Docker available and skips cleanly without it.

### S7 — Client types + hooks
- **Files:** `client/src/lib/types.ts` (re-export `EvalCase`, `EvalRun`, `EvalRunRecord`, `EvalRunResult`, `EvalDashboard`, `EvalTrendPoint`, `EvalOwnerKind` from `@devdigest/shared`), `client/src/lib/hooks/evals.ts` (new)
- **Contents:** `useEvalCases(agentId)`, `useCreateEvalCase()`, `useDeleteEvalCase()`, `useRunEvalSet(agentId)`, `useEvalBatches(agentId)`, `useAgentEvalDashboard(agentId)`, `useWorkspaceEvalDashboard()`. All go through `api` from `client/src/lib/api.ts` — **never `fetch` directly, and never a Next route handler (there are none)**. The `ActualOutput` envelope type is declared **locally in this file** with a comment citing the `blast.ts` precedent; every shape that exists in `@devdigest/shared` is imported, not redeclared. Mutations invalidate the eval query keys (and nothing else).
- **Skill:** `react-best-practices`, `typescript-expert`
- **Test:** `none — no behaviour change`; the hooks are exercised through S8–S11's component tests.
- **Depends on:** S1 (envelope), S5 (URLs)
- **Done when:** `client/pnpm typecheck` passes and no eval type that `@devdigest/shared` already exports is redeclared.

### S8 — "Turn into eval case" on the finding card
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (+ button, + `onEvalCase` / `evalCasePending` props), `.../FindingCard/styles.ts`, `.../FindingsPanel/FindingsPanel.tsx` (thread the prop through to `FindingCard`, ~`:92-100`), `.../ReviewRunAccordion/ReviewRunAccordion.tsx` (wire the mutation; pass `review.agent_id` for BQ-2a's body fallback), `client/messages/en/prReview.json` (button + tooltip copy — **check `eval.json` first**, much of the copy already exists)
- **Contents:** a third button in the existing `s.actions` row beside Accept/Dismiss (`FindingCard.tsx:91-111`), using `Button` with `kind` (not `variant`). **Disabled with a tooltip stating the reason** — not hidden — when `!f.accepted_at && !f.dismissed_at` (AC-3). Success toast via the existing `lib/toast.tsx`.
- **Skill:** `react-best-practices`, `react-testing-library` (**`fireEvent`, never `userEvent`**)
- **Test:** extend `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` — disabled + tooltip when unlabelled; enabled and invoked with the right args when `accepted_at` is set; the same when `dismissed_at` is set.
- **Depends on:** S7
- **Done when:** all three cases pass and the button is **disabled, not absent**, for unlabelled findings.

### S9 — Evals tab in the Agent Editor
- **Files:** `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,index.ts,styles.ts,EvalsTab.test.tsx}` (new), `.../AgentEditor/constants.ts` (+ `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }`), `.../AgentEditor/AgentEditor.tsx` (+ `TAB_PANELS.evals`), **`client/src/app/agents/[id]/page.tsx` (+ `"evals"` in `VALID_TABS`, line 16)**
- **Contents:** three `MetricCard`s with deltas against the previous batch, the case list with each case's last result, Run / Delete actions with a `running` state. **All copy already exists** under `eval.json`'s `evalsTab.*` and `agents.json`'s `editor.tabs.evals`. Precision renders **"n/a"** when `TP + FP = 0` (**REC-2**).
- **Trap:** adding a tab needs **two** edits — `TABS` *and* `page.tsx`'s `VALID_TABS`. An omitted key does not 404 or warn; the page silently falls back to Config, reading as a dead tab button (`client/INSIGHTS.md`, 2026-08-29, which names the Evals tab as the next victim).
- **Skill:** `react-best-practices`, `next-best-practices`
- **Test:** `EvalsTab.test.tsx` — empty state renders `evalsTab.emptyCases`; a populated list renders pass/fail per case; metric cards render deltas; precision renders "n/a" at `TP+FP = 0`. Plus one case in `AgentEditor.test.tsx` asserting `?tab=evals` renders the **Evals** panel and not Config — the exact regression that fails silently.
- **Depends on:** S7
- **Done when:** both `TABS` and `VALID_TABS` list `evals`, proven by the AgentEditor test.

### S10 — Eval Dashboard page + sidebar entry
- **Files:** `client/src/app/eval/page.tsx` (new), `client/src/app/eval/_components/EvalDashboardView/{EvalDashboardView.tsx,index.ts,styles.ts,EvalDashboardView.test.tsx}` (new), **`client/src/vendor/ui/nav.ts`** (+ one item in the `SKILLS LAB` group: `{ key: "eval", label: "Eval Dashboard", icon: "FlaskConical", href: "/eval" }`)
- **Contents:** every agent with its latest recall / precision / citation, a `LineChart` metric trend, and a recent-runs table **across agents**, labelled from the envelope's `agent.name` (**REC-1** — without it this table cannot say which agent a run belongs to). Copy from `eval.json`'s `dashboard.*` and `page.*`. `AppShell` + breadcrumb `Skills Lab / Eval Dashboard`. Precision "n/a" rule as in S9 (**REC-2**).
- **Already done for you:** `activeKeyFor` maps `/eval` → `"eval"` (`app-shell/helpers.ts:38`) and `shell.json`'s `nav.eval` exists. The `nav.ts` literal is the **only** missing half — the sidebar label is a literal rendered by `NavItem.tsx` and is *not* i18n-bound, while the palette entry *is* (`client/INSIGHTS.md`, 2026-08-29).
- **Skill:** `next-best-practices`, `react-best-practices`
- **Test:** `EvalDashboardView.test.tsx` — empty state (`dashboard.noRuns`); a populated agent list; a recent-runs table showing agent attribution.
- **Depends on:** S7
- **Done when:** the sidebar shows "Eval Dashboard" under SKILLS LAB, the row highlights on `/eval`, and the command palette's "Go to Eval Dashboard" resolves — both halves wired.

### S11 — Compare two runs
- **Files:** `client/src/app/eval/_components/CompareModal/{CompareModal.tsx,index.ts,styles.ts,CompareModal.test.tsx}` (new); selection state added to `EvalDashboardView`
- **Contents:** a `Checkbox` per **batch** row (BQ-4a); a Compare button enabled **only at exactly two selections** (AC-18 / AC-19); a `Modal` showing each metric as `old → new (Δ)` plus a line-level diff of the two batches' stored `agent.system_prompt` values, read from the envelope. When the two snapshots' `system_prompt` values are identical but a skill `content_hash` differs, say so — that is precisely what **REC-6** buys, and the modal is the only place it becomes visible.
- **Skill:** `react-best-practices`, `react-testing-library`
- **Test:** `CompareModal.test.tsx` — renders both metric deltas and a prompt diff with at least one changed line; renders the "prompts identical, skill content changed" note when hashes differ. Plus selection tests in `EvalDashboardView.test.tsx` — Compare disabled at **0, 1 and 3** selections, enabled at exactly **2**.
- **Depends on:** S10
- **Done when:** the enable/disable rule is asserted at all four selection counts.

### S12 — Dataset: ≥ 8 labelled cases, plus seeded cases and batches for e2e
- **Files:** `server/src/db/seed.ts`
- **Contents, part 1 (BQ-1a — the dataset for the experiment):** add `patch` hunks for `src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts` and `src/api/users.ts` whose **new-side line numbers cover the existing findings' ranges** (`seed.ts:214+`); add 2–3 style-nit findings destined for dismissal; set `acceptedAt` on ~5 findings and `dismissedAt` on ~4; **attribute the seeded review to the Security Reviewer agent** (`agentId`) so BQ-2a's first branch is reachable on demo data.
  **Trap:** patch bodies carry **hunks only** — no `diff --git` / `---` / `+++` header lines. `diffFromPrFiles` re-adds them and the client's `parsePatch` reads a bare `-`/`+` per line, so a header would be mis-parsed as a deleted/added line (`seed.ts:159-165`; `server/INSIGHTS.md`, 2026-08-23).
- **Contents, part 2 (forced by accepting REC-7):** seed **≥ 8 `eval_cases` rows** owned by the Security Reviewer and **two synthetic `eval_runs` batches** (plain rows with differing `agent.system_prompt` snapshots and visibly different metrics — **no model call**), so the e2e flow can assert a populated dashboard and a working Compare gate against read-only data. This is *additive* to part 1, not a replacement for the one-click flow, which stays covered by S6 and the manual experiment.
- **Idempotency:** the seed is upsert-shaped and must stay so — re-running is a no-op.
- **Skill:** `drizzle-orm-patterns` (the hunk/line arithmetic is data design, **not DDL — there is no DDL in this plan**)
- **Test:** `server/test/evals-seed.it.test.ts` — after `seed()`: at least 8 findings carry a decision; every such finding's file appears in `diffFromPrFiles(prId)` with an **overlapping** hunk; at least 8 `eval_cases` and exactly 2 distinct `batch_id`s exist; a second `seed()` changes no row count.
- **Depends on:** — (may start immediately; S6 and S15 assert against it)
- **Done when:** the test above passes and `pnpm db:seed` twice is a no-op the second time.

### S13 — `pnpm verify:l06`
- **Files:** `scripts/verify-l06.sh` (new, executable), `server/package.json` (+ `"verify:l06": "../scripts/verify-l06.sh"`), `client/package.json` (same)
- **Note:** **there is no root `package.json`** — the `verify:l03` precedent registers the script in both `server/package.json:15` and `client/package.json:11`, and `verify-l04.sh` was never registered at all. Do both.
- **Contents:** modelled on `verify-l03.sh` (exit status = number of failures; **every check runs even after one fails**; the `DOCKER_HOST`/OrbStack shim at `:41-47`), using `verify-l04.sh`'s `code_only()` and `empty()` helpers. Checks:
  1. `diff -rq server/src/vendor/shared client/src/vendor/shared` prints nothing.
  2. `git status --porcelain server/src/vendor/shared client/src/vendor/shared server/src/db/migrations` prints nothing — **no contract edit, no migration**.
  3. Both tables present in `0000_init.sql` (the spec's "the two tables exist" condition).
  4. **REC-4** — after comment-stripping, no `container.llm` / `.complete(` / `completeStructured` in `evals/scoring.ts` or `evals/repository.ts`, and no direct `assemblePrompt` call anywhere under `evals/` (the untrusted-input guarantee). `verify-l04.sh`'s header records that its *first* version failed by matching a comment; use `code_only()`.
  5. Typecheck all four packages (`server`, `client`, `reviewer-core`, `e2e`).
  6. Suites: `reviewer-core`, `client`, `server` — with a `--no-it` switch to skip the Docker-backed ones.
  7. The spec's remaining conditions — a case creatable from each decision type, a run producing all three metrics, ≥ 8 cases — are delegated to `evals.it.test.ts` and `evals-seed.it.test.ts` rather than re-implemented in bash.
  8. e2e is **not** run by default (it needs a live stack); print a one-line hint pointing at `./scripts/e2e.sh`.
- **Skill:** none (bash) — follow the two existing scripts' structure verbatim
- **Test:** `none — the script is the test`
- **Depends on:** S6, S9, S10, S11, S12
- **Done when:** `cd server && pnpm verify:l06` exits 0, **and** deliberately breaking one invariant (e.g. touching a `vendor/shared` file) makes it exit non-zero naming that check.

### S14 — Docs + insights
- **Files:** `server/README.md` (an Evals subgraph in the API map, `:60-88`), `server/INSIGHTS.md`, `client/INSIGHTS.md` (**append-only**)
- **Contents (REC-8):** the four traps found while planning — (1) `eval_cases`/`eval_runs` ship in `0000_init.sql`, so the L06 feature needs **no migration**; (2) `messages/en/eval.json` + `shell.json`'s `nav.eval` shipped with **zero readers**, the third instance of the `blast.json` pattern; (3) the seed's `pr_files` carry a `patch` on **one file only**, so `diffFromPrFiles` yields a one-file diff and any case built on another file can neither match nor ground; (4) the seeded review has a **null `agent_id`**, so anything deriving an owner agent from a finding must have a fallback. Plus (5), from S1: **`skills` has no `slug` column** — "skill slugs" in the eval-ci contract comment refers to the CI manifest, not this database.
- **Skill:** `mermaid-diagram`, `engineering-insights`
- **Test:** `none — documentation`
- **Depends on:** S13
- **Done when:** the API map lists all seven eval routes, and each INSIGHTS entry is file-grounded, non-duplicate (re-read the file first), and appended — never overwriting.

### S15 — Deterministic e2e flow (REC-7)
- **Files:** `e2e/specs/10-evals.flow.json` (new)
- **Contents:** a read-only flow over seeded data, in the `08-project-context.flow.json` style (a `name`, a `description` that states its preconditions and why it is safe, and `steps` of agent-browser commands).
  Assertions: `/eval` renders the dashboard title, the seeded agent row with its metrics, and the recent-runs table; selecting **one** batch leaves Compare disabled; selecting a **second** enables it and the modal renders `old → new` deltas and a prompt diff (checkbox selection is **client state only — no POST**); `/agents/:id?tab=evals` renders the seeded case list and the three metric cards; on PR #482 the finding card shows "Turn into eval case" **enabled** on a seeded accepted finding and **disabled** on an unlabelled one.
  **The flow never clicks "Turn into eval case" and never presses Run eval.** Every existing flow is read-only against seeded data (`e2e/README.md:35-36`; flow `08`'s own note "no POST is made anywhere in this flow"), a mutation would break the freshly-seeded precondition, and a run would call a model — which flows never do.
- **Skill:** none (JSON flow spec) — mirror `08-project-context.flow.json`'s conventions
- **Test:** the flow *is* the test; run via `cd e2e && npm test` against a stack, or the hermetic `./scripts/e2e.sh`.
- **Depends on:** S10, S11 (the surfaces), S12 part 2 (the seeded cases and two batches)
- **Done when:** `10-evals.flow.json` passes against a freshly-seeded hermetic stack and makes zero POST requests.

---

## Contract & DB changes

**There are none in either protected zone, and that is this plan's most valuable finding.**

- **`server/src/vendor/shared/` and `client/src/vendor/shared/` — not touched.** All six eval contracts already exist and are consumed as given. Both copies were verified byte-identical. `verify:l06` check (1) re-asserts `diff -rq …` prints nothing and check (2) asserts `git status --porcelain` over both paths is empty. **The shared barrel is not extended, edited, or mirrored — there is nothing to mirror.**
- **`server/src/db/migrations/` — not touched.** `eval_cases` and `eval_runs` are created in `0000_init.sql:116-140` with their FKs at `:376-377`. **No schema edit, no `pnpm db:generate`, no `pnpm db:migrate`, no new migration file.** The spec commits to adding no columns; `batch_id` and the agent snapshot live inside the existing `actual_output` jsonb.
- **New shapes are module-local only:** `server/src/modules/evals/contract.ts` (server) and a locally-declared envelope type inside `client/src/lib/hooks/evals.ts` (client), per the `blast` precedent.
- **`server/src/db/seed.ts` is data, not schema.** S12 adds rows and patch text. `pnpm db:seed` is the only DB command this plan runs, and it stays idempotent.

## Verification

| Package | Command | Gate | Stage |
|---|---|---|---|
| `server/` | `pnpm typecheck` | must pass | implementer (per track), plan-verifier |
| `server/` | `pnpm exec vitest related <changed files>` | own diff only | implementer (during) |
| `server/` | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | unit suite green | implementer (end of track) |
| `server/` | `pnpm exec vitest run .it.test` | integration green (Docker; `DOCKER_HOST` shim per `verify-l03.sh:41-47`) | plan-verifier |
| `client/` | `pnpm typecheck` | must pass | implementer (end of track), plan-verifier |
| `client/` | `pnpm test` | colocated component tests green | implementer (end of track) |
| `reviewer-core/` | `npm run typecheck` | must pass (unchanged, but it is in the server's program) | plan-verifier |
| `reviewer-core/` | `npm test` | green | plan-verifier |
| `e2e/` | `npm run typecheck` | must pass | plan-verifier |
| `e2e/` | `./scripts/e2e.sh` (hermetic) or `npm test` against a running stack | **optional row — REC-7**; needs a live stack + freshly-seeded DB | plan-verifier |
| repo | `diff -rq server/src/vendor/shared client/src/vendor/shared` | prints nothing | implementer (before and after), plan-verifier |
| repo | `git status --porcelain server/src/db/migrations server/src/vendor/shared client/src/vendor/shared` | prints nothing | plan-verifier |
| repo | `cd server && pnpm verify:l06` | **exits 0 — the gate** | plan-verifier |

No lint row: there is no ESLint, Biome, or Prettier config and no `lint` script in any package. Never add a lint step.

**Permission prompts to expect.** `.claude/settings.local.json` pre-approves only three git commands, and the single project hook guards writes under `specs/`. The executing agent will be prompted for `pnpm install`, `pnpm test` / `vitest`, `pnpm db:seed`, `chmod +x scripts/verify-l06.sh`, Docker/testcontainers startup, and (for S15) `./scripts/e2e.sh` bringing up a stack. Approve these up front rather than letting a track stall.

### Acceptance criteria carried from the spec

| AC | From spec | Verified by | Covered by step |
|---|---|---|---|
| AC-1 | accepted → `must_find` with file/lines/severity/category | `evals.it.test.ts`, `evals-contract.test.ts` | S1, S4, S6 |
| AC-2 | dismissed → `must_not_flag` with file + range only | `evals.it.test.ts` | S1, S4, S6 |
| AC-3 | unlabelled → button disabled, reason in the tooltip | `FindingCard.test.tsx`; server half in `evals.it.test.ts` (422) | S4, S8 |
| AC-4 | `input_diff` stored at creation, replayable after the branch is gone | `evals.it.test.ts` | S4, S6 |
| AC-5 | existing case returned, never a duplicate | `evals.it.test.ts` | S3, S4, S6 |
| AC-6 | run over every case using only stored `input_diff`/`input_files`/`input_meta` | `evals-service.test.ts` (asserts the engine input key set) | S4 |
| AC-7 | no live repo, PR, or index read during a run | `evals-service.test.ts` + `verify:l06` static check | S4, S13 |
| AC-8 | one row per case, shared `ran_at` + `batch_id` | `evals.it.test.ts` | S4, S6 |
| AC-9 | `actual_output` envelope incl. the agent snapshot | `evals-contract.test.ts`, `evals.it.test.ts` | S1, S4, S6 |
| AC-10 | zero model calls in scoring | mock call-count assertion in `evals.it.test.ts` + `verify:l06` grep | S2, S6, S13 |
| AC-11 | match = equal file AND overlapping ranges | `evals-scoring.test.ts` | S2 |
| AC-12 | recall definition; 1 when no `must_find` | `evals-scoring.test.ts` | S2 |
| AC-13 | precision definition; 1 when `TP+FP = 0`; unmatched ignored | `evals-scoring.test.ts`; "n/a" display in `EvalsTab.test.tsx` | S2, S9, S10 (REC-2) |
| AC-14 | `citation_accuracy` = share surviving grounding; 1 when no findings | `evals-scoring.test.ts`, `evals-service.test.ts` | S2, S4 |
| AC-15 | `pass` = all must-find matched AND no must-not-flag matched | `evals-scoring.test.ts` | S2 |
| AC-16 | Evals tab lists every case with its last result + three metrics with deltas | `EvalsTab.test.tsx`, `AgentEditor.test.tsx` | S9 |
| AC-17 | Eval Dashboard under Skills Lab; every agent + recent runs across agents | `EvalDashboardView.test.tsx`; `10-evals.flow.json` | S10 (needs REC-1), S15 |
| AC-18 | exactly two selected → Compare shows `old → new`, Δ, and the prompt diff | `CompareModal.test.tsx`; `10-evals.flow.json` | S11, S15 |
| AC-19 | fewer or more than two → Compare disabled | `EvalDashboardView.test.tsx` (0/1/3); `10-evals.flow.json` | S11, S15 |
| AC-20 | ≥ 8 cases in the set | `evals-seed.it.test.ts` + `verify:l06` | S12, S13 |
| AC-21 | prompt edit + re-run moves recall/precision visibly | **manual experiment** — non-deterministic, not gateable; produces the screenshot | S12 enables it; Handoff |
| AC-22 | degraded prompt lowers precision | **manual experiment**, same | S12 enables it (style-nit dismissals are what make it bite); Handoff |
| AC-23 | `verify:l06` exits non-zero when any of the five conditions is false | run it, break one invariant, re-run | S13 |
| Edge-1 | empty case set → 422 naming the agent | `evals-service.test.ts` | S4 |
| Edge-2 | zero findings → recall 0 / precision 1 / citation 1 | `evals-scoring.test.ts` | S2 |
| Edge-3 | finding deleted → the case survives | `evals.it.test.ts` | S3, S6 |
| Edge-4 | adjacent, non-overlapping lines → not a match | `evals-scoring.test.ts` | S2 |
| Edge-5 | renamed file → not a match | `evals-scoring.test.ts` | S2 |
| Edge-6 | two expectations on the same lines → greedy, one each, file order | `evals-scoring.test.ts` | S2 |
| Edge-7 | run interrupted mid-set → rows stay, partial via `traces_total` | `evals-service.test.ts` | S4 |
| Sec-1 | `input_diff` reaches the model only through `wrapUntrusted` | `verify:l06` static check that `evals/` never calls `assemblePrompt`/`completeStructured` directly | S4, S13 |
| Sec-2 | `expected_output` written by the server, never accepted from the client | `evals-routes.test.ts` (body schema carries no `expected_output`) | S1, S4, S5 |

---

## Execution — single-agent pass (not chosen)

One `implementer`, in order:

**S1 → S2 → S3 → S4 → S5 → S6 → S12 → S7 → S8 → S9 → S10 → S11 → S15 → S13 → S14**

Interleaved verification: `pnpm typecheck` + `vitest related` after each of S1–S5; the server unit suite after S5; `vitest run .it.test` after S6 and again after S12; `client pnpm typecheck` after S7; `client pnpm test` after each of S8–S11; the hermetic e2e run after S15; `pnpm verify:l06` after S13.

**Honest cost:** 15 steps across three packages, with the Docker integration suite run at least twice and a browser stack brought up once — realistically **several hours of serial wall-clock**, dominated by the integration and e2e passes rather than by the writing. Its advantage is that the envelope (S1) and the batch semantics (BQ-4a) stay in one head while both ends are written, so no cross-track misunderstanding is possible.

## Execution — multi-agent run (CHOSEN)

| Track | Steps | Agent | Model | File set | Starts after | Brief |
|---|---|---|---|---|---|---|
| **T0 — envelope freeze** | S1 | `implementer` | **opus** | `server/src/modules/evals/contract.ts`, `server/test/evals-contract.test.ts` | — | "Write the module-local eval contract: the expectation union, `ExpectedOutput`, and the `actual_output` envelope — including `agent.id`/`agent.name` (REC-1) and a per-skill `{id, name, version, content_hash}` (REC-6). **There is no `slug` column on `skills`**; do not invent one. Zod, ESM `.js` imports. `vendor/shared` is do-not-touch and needs no change. This shape is a barrier: the server run loop and the client compare modal both read it." |
| **T1 — server core** | S2, S3, S4, S5, S6 | `implementer` | **opus** | `server/src/modules/evals/{scoring,repository,service,routes}.ts`, `server/src/modules/index.ts`, `server/test/evals-{scoring,service,routes}.test.ts`, `server/test/evals.it.test.ts` | T0 | "Build the `evals` module. Scoring is pure — no I/O, no clock, no randomness, zero model calls; every spec edge case gets a named test. The run loop calls `reviewPullRequest` with **only** systemPrompt/model/diff/llm/skills — no repo-intel, no project-context, no intent, no PR body. Score the **post-grounding** set and take `citation_accuracy` from `outcome.review.findings` vs `outcome.dropped` — **never call `groundFindings` again**. `input_diff` is a `sliceDiff` of one file. One `batch_id` per run; batch is the unit. Synchronous route, 50-case cap, `{rateLimit:{max:10,timeWindow:'1 minute'}}`. Tenancy via `getContext`; cross-workspace is 404, not 403. You own the single registry line in `modules/index.ts` — no other track edits it. Do not modify `reviews/repository/skill.repo.ts`; add a sibling query." |
| **T2 — data + gate + e2e** | S12, then S13, S15 | `implementer` | **opus** | `server/src/db/seed.ts`, `server/test/evals-seed.it.test.ts`, `scripts/verify-l06.sh`, `server/package.json`, `client/package.json`, `e2e/specs/10-evals.flow.json` | S12 at T0; S13/S15 after T4 | "Part 1: extend the seed so ≥ 8 findings carry a decision **and** their files carry overlapping hunks — patch bodies are **hunks only**, no `diff --git`/`---`/`+++` headers; attribute the seeded review to the Security Reviewer. Part 2: also seed ≥ 8 `eval_cases` and two synthetic `eval_runs` batches with differing prompt snapshots so the e2e flow has read-only data. Keep the seed idempotent. Then write `verify-l06.sh` on the `verify-l03.sh` skeleton with `verify-l04.sh`'s `code_only()` comment-stripper — **there is no root package.json**, so register the script in both server's and client's. Finally the e2e flow: read-only, **no POST, no run**, mirroring `08-project-context.flow.json`." |
| **T3 — client data + finding card** | S7, S8 | `implementer` | **sonnet** | `client/src/lib/types.ts`, `client/src/lib/hooks/evals.ts`, `.../FindingCard/*`, `.../FindingsPanel/FindingsPanel.tsx`, `.../ReviewRunAccordion/ReviewRunAccordion.tsx`, `client/messages/en/prReview.json` | T0 (envelope) + T1 (URLs) | "Add the eval hooks over `lib/api.ts` and the 'Turn into eval case' button. Types come from `@devdigest/shared`; only the envelope is declared locally, citing the `blast.ts` precedent. The button is **disabled with a tooltip**, never hidden, for unlabelled findings, and passes `review.agent_id` for the owner fallback. `Button` takes `kind`, not `variant`. Tests use `fireEvent` — `user-event` is not installed and fails at import." |
| **T4 — client surfaces** | S9, S10, S11 | `implementer` | **sonnet** | `client/src/app/agents/[id]/{page.tsx,_components/AgentEditor/**}`, `client/src/app/eval/**`, `client/src/vendor/ui/nav.ts` | T3 | "Build the Evals tab, the `/eval` dashboard and the compare modal. **Nearly all copy already exists** in `messages/en/eval.json` — read it first and add no key you do not need. Two two-place traps: a tab needs `TABS` **and** `page.tsx`'s `VALID_TABS` (an omitted key silently renders Config); the nav needs the `nav.ts` literal (`shell.json`'s `nav.eval` and `activeKeyFor`'s `/eval` branch already exist). Styling is colocated `styles.ts`, not Tailwind. Compare enables at **exactly** two selections. Precision renders 'n/a', not '100%', when TP+FP is 0. **Layout reference:** `docs/designs/DevDigest Design (standalone) (1).html` is the canonical mockup, but grep finds nothing in it — the UI source is gzip+base64 inside a JSON resource map on one ~1.8 MB line (`<script type=\"__bundler/manifest\">`). JSON-parse that line, then per entry `base64.b64decode` → `gzip.decompress`; `text/javascript` resources come out as readable source. `file://` is blocked in the browser tool, so decode rather than open. It likely dictates layout details this plan does not specify (dashboard agent table, per-agent trend, compare modal, case-editor modal)." |
| **T5 — docs** | S14 | `doc-writer` | **sonnet** | `server/README.md`, `server/INSIGHTS.md`, `client/INSIGHTS.md` | T4 | "Add an Evals subgraph to the API map (seven routes) and append the five session findings to the two INSIGHTS files. **Append-only** — re-read each file first and duplicate nothing." |
| **Gate** | — | `plan-verifier`, then `architecture-reviewer` | opus | read-only | T2 complete | Re-run the verification table once, including `pnpm verify:l06` and the optional e2e row; grade a settled diff. |

**Barriers:**

1. **T0 is a hard barrier** for T1 and T3 — the envelope is what both ends read. It is small; do not fold it into T1.
2. **`server/src/modules/index.ts` belongs to T1 alone.** No other track edits that file.
3. **There is no DB barrier** — no schema edit, no `db:generate`, no `db:migrate`. This is precisely why this feature parallelises better than a normal full-stack chain, and it is the deciding factor below.
4. **The contract barrier is vacuous** — no track enters `vendor/shared`; `diff -rq` is asserted at the gate and by `verify:l06`.
5. **T3 → T4** on `client/src/lib/hooks/evals.ts`. T4 must not create its own hooks file.
6. **T2 splits around T4:** S12 runs early (disjoint from everything), while S13 and S15 wait for T4 because they assert against the client suites and the client surfaces.
7. **Reviewers start after the last write** (T2's S15), never alongside one.
8. **`test-writer` is not scheduled** — coverage rides on each step's named `Test` line, and the implementer writes it.
9. **Test staging:** each implementer runs typecheck + `vitest related` on its own diff, then its package's full suite once at the end of its track. `plan-verifier` re-runs the verification table **once** as the gate. Nobody runs the same suite twice.

**Worktree isolation needed:** **yes, for T3 and T4 if run concurrently** — same package, and T4 imports T3's hooks. The chosen shape **sequences T3 → T4** and needs no worktrees at all. T1 (server) and T3 (client) have fully disjoint file sets and run concurrently once T0 lands; T2's S12 is disjoint from T1's module folder and can run alongside either.

**Why multi-agent was chosen.** The deciding factor is the absence of both usual barriers — the contracts and the migration already shipped — so the server module and the client surfaces share **no file whatsoever**, and the reason full-stack lesson work is normally serialised does not apply here. T1 carries the logic that must not be wrong (opus); T3/T4 are trap-laden but mechanical, and the traps are already written down in `client/INSIGHTS.md` and repeated in their briefs (sonnet).

**`--max-agents` must be ≥ 6** for T0–T5 to execute as written. If the ceiling is 5, **collapse T5 into T4** (the doc step is small and touches no code T4 owns); do not collapse T0 into T1, and do not merge T3 with T4 without worktree isolation.

## Cost envelope

| Mode | Agent invocations | Model tiers | What dominates the cost |
|---|---|---|---|
| single-agent | **5** — 1 implementer (15 steps, long) + 1 plan-verifier + 1 architecture-reviewer + 2 fix rounds | one opus session throughout | One agent carrying 15 steps of context across three packages; the Docker integration suite run repeatedly inside that session, plus one browser-stack e2e pass |
| **multi-agent (chosen)** | **10** — 6 implementer/doc tracks (T0–T5) + 1 plan-verifier + 1 architecture-reviewer + 2 fix rounds | opus ×3 (T0, T1, T2), sonnet ×3 (T3, T4, T5), opus for both reviewers | Per-track context re-reads; T1 is the largest single track. The saving comes from sonnet on T3/T4, where the copy is already written and the two failure modes are already documented |

Fix rounds are budgeted at the standard two. REC-7 adds roughly one stack bring-up (~10–15 minutes of wall-clock) to each verification pass in **both** modes; REC-6 adds no measurable cost beyond one test.

## Risks & open questions

- **The spec's route table gained a route.** `GET /agents/:id/eval-runs` (the batch list) is **not** in the approved spec's Contracts table; it follows from **BQ-4a** (the batch is the unit) and is required by the run-history table and Compare. This is a deliberate addition to an approved spec — say so in the PR description so a reviewer does not read it as scope creep.
- **AC-21 and AC-22 are manual experiments, not gated checks.** Whether editing a system prompt visibly moves recall/precision, and whether a deliberately degraded prompt lowers precision, are properties of a model run, not of the code. They produce the **screenshot** and **screencast** deliverables. `verify:l06` checks only the five mechanical conditions the spec enumerates. If the degraded prompt does not move precision, the most likely cause is too few `must_not_flag` cases — which is exactly why S12 seeds 2–3 deliberate style-nit dismissals.
- **REC-7 forced an extension to S12** (seeded `eval_cases` + two synthetic batches), because e2e flows are strictly read-only. This is additive and does not replace the one-click flow, but if you would rather not seed eval rows, delete S15 and S12 part 2 together.
- **`batch_id` lives in jsonb and cannot be indexed** (spec open question 1). Acceptable at this scale; the honest fix later is a `batch_id` column, which is a migration and therefore a new decision — never a silent one taken mid-implementation.
- **Precision stays structurally weak** until dismissed cases outnumber the agent's unlabelled discoveries (spec open question 2). REC-2 makes that visible rather than printing a flattering "100%".
- **REC-6 records a hash, not a body.** Two runs can now be told apart when a skill changed underneath, but the plan still does not store what the skill *said* — reconstructing a past run's exact prompt remains impossible. That is a deliberate cost ceiling, not an oversight.
- **The planner ran no test suite and started no database.** Every claim here comes from reading files. The one thing unverifiable by reading is whether the integration suite is currently green on the base branch — **confirm a green baseline before S6** so a pre-existing failure is not attributed to this feature.
- **The design mockup was not decoded.** Its source is gzip+base64 inside a JSON resource map (procedure in T4's brief and `client/INSIGHTS.md`, 2026-08-02). It very likely specifies layout details this plan leaves open; T4 should decode it rather than invent a layout.

## Handoff

- **Read first (absolute paths):**
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/specs/eval-pipeline.md`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/vendor/shared/contracts/eval-ci.ts`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/vendor/shared/contracts/knowledge.ts` (lines 49–84)
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/db/schema/eval.ts`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/db/migrations/0000_init.sql` (lines 116–140)
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/reviewer-core/src/review/run.ts`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/modules/reviews/run-executor.ts`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/modules/reviews/diff-loader.ts`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/src/db/seed.ts` (lines 100–260)
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/client/messages/en/eval.json`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/client/INSIGHTS.md`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/server/INSIGHTS.md`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/scripts/verify-l03.sh` and `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/scripts/verify-l04.sh`
  `/Users/sergyinfo/Learn/GoIT/AIEngineering/neoversity-dev-digest/e2e/specs/08-project-context.flow.json`
- **Never read or cite `server/clones/`** — it is a runtime self-clone holding stale duplicates of every `CLAUDE.md`, `INSIGHTS.md`, and test file.
- **Manual deliverables, not steps:** the two-run comparison screenshot (metrics + prompt diff) and the end-to-end screencast. S12 exists so both are reproducible.
- **Not reviewed here:** architecture and security review are separate agents. The `security` skill is named on S4 as a guardrail because `input_diff` is stored, attacker-controlled content replayed into a model prompt on every future run — worse than the live path, which is why it must stay behind `wrapUntrusted` and why S13 checks it statically.
- **Nothing in the repository was modified while planning.**

---

## PART 3 — Repository constraints a stranger cannot infer

- This is NOT a monorepo workspace. `server`, `client`, `reviewer-core`, `e2e` (and others) are standalone packages, each with its own package.json and lockfile. Cross-package code is shared via tsconfig path aliases into raw TypeScript source. There is no root package.json.
- `@devdigest/shared` exists as TWO vendored copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — which must stay byte-identical. Both are do-not-touch in this plan.
- `reviewer-core` has an iron rule: it performs no I/O. Everything reaches it as arguments.
- Validation is Zod throughout. The HTTP error envelope is fixed: request-validation failure is 422 with `{error:{code:'validation_error',...}}`; cross-tenant access is 404, never 403.
- Database migrations are GENERATED by drizzle-kit and never hand-written. The migrations directory is do-not-touch.
- Server modules are registered statically in one index file; there is no filesystem autoload.
- ESM: relative imports carry an explicit `.js` extension in the server and e2e packages, but not in the client.
- **There is no linter in this repository** — no ESLint, no Biome, no Prettier, no lint script. Do not suggest adding one.
- Server tests live in a separate `server/test/` directory; client tests are colocated. Filenames containing `.it.test.ts` require Docker and a real Postgres.
- End-to-end flows are deterministic JSON specs: they call no LLM and never mutate data.

---

## PART 4 — Your instruction

Review this implementation plan against the specification it claims to satisfy. You have not seen the codebase — do not guess at what the code looks like, and say so where it matters. Report only: (a) requirements in the spec that no plan step covers; (b) plan steps that satisfy nothing in the spec; (c) steps whose "Done when" could pass while the requirement still fails; (d) ordering or dependency errors; (e) risks the plan does not name. For each, give the requirement or step ID. **Do not propose a different design, and do not rewrite the plan.** If the plan is sound, say so — "no findings" is a valid answer.
