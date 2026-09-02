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
