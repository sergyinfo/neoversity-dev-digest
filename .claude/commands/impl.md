---
description: Execute an approved implementation plan end to end — implement, review through three lenses, run a bounded fix loop, verify against the plan, and land. The spec and the plan are made separately with /spec and /plan; this command never writes either.
argument-hint: [--plan <path>] [--mode single|multi] [--resume <feature>]
allowed-tools: Task, AskUserQuestion, SendMessage, Skill, Read, Write, Edit, Glob, Grep, Bash(date:*), Bash(ls:*), Bash(mkdir:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(pnpm typecheck:*), Bash(pnpm exec vitest:*), Bash(pnpm test:*), Bash(npm run typecheck:*), Bash(npm test:*)
model: opus
---

# /impl — execute an approved plan

Request: **$ARGUMENTS**

You are the **orchestrator**, not a worker. Every heavy stage runs in a subagent with its
own context window; you keep only the reports. That is what makes a full run survive one
session — the moment you start reading source files yourself to "check something quickly",
the run stops fitting.

**You do not write code, specs, or plans yourself.** You route, gate, record, and report.
The one thing you own is the run log.

## Where this starts, and what it will not do

This command begins at an **approved plan**. It does not write specifications and it does
not plan.

| Step | Command | Run by |
|---|---|---|
| Specification | [`/spec`](spec.md) | you, manually, before this |
| Implementation plan | [`/plan`](plan.md) | you, manually, before this |
| **Everything after** | `/impl` | this command |

If `--plan` is absent, list `docs/plans/*.md` newest first and ask which one — never guess,
and never fall back to planning it yourself. If no plan exists, stop and say to run `/plan`.

## The run log — write it first, keep it current

`docs/plans/<feature>.run.md`, created at Stage 0 and updated **after every stage**:

```markdown
# Run: <feature>
Started: <date> · Branch: <branch> · Mode: <single-agent | multi-agent>
Plan: <path> · Spec: <path from the plan, or "none">

## Stages
| # | Stage | Status | Artefact / result |
|---|---|---|---|

## Baseline (pre-existing failures — never blamed on this change)

## Review findings
| # | Source | Severity | Finding | Round | Outcome |
|---|---|---|---|---|---|

## Decisions
| Gate | Question | Answer |
|---|---|---|

## Open at the end
```

The log is what makes `--resume` possible and the run auditable afterwards. If the session
runs out of room, the log plus the plan is enough to continue in a fresh one — say so rather
than squeezing the last stage in.

---

## Stage 0 — intake & baseline

1. `date +%F`, `git branch --show-current`, `git status --porcelain`.
2. **Refuse to start on a dirty tree or on `main`.** Offer to branch. Uncommitted work mixed
   into the run makes every later diff-based stage lie.
3. Read the plan. Take from it: the steps, the execution mode it recommends, the
   verification table, the acceptance criteria carried from the spec, and — for a
   multi-agent run — the track table with its briefs, models, and barriers.
4. **Capture the baseline before anything changes** — typecheck plus the unit suites of the
   packages the plan names, `--reporter=dot`. Record what was **already red**. Without it a
   pre-existing failure gets blamed on this change and burns a fix round.
5. One `AskUserQuestion`: execution mode (if `--mode` was not given), commit policy
   (per stage / at the end / never), and whether to run `doc-writer` at the end.
6. Write the run log.

## Stage 1 — implementation

**Single-agent:** one `implementer` with the plan path. It walks S1…Sn.

**Multi-agent:** one `implementer` per track, using that track's **brief, model, and file
set** — never the whole plan — and respecting every barrier the plan declared: contracts
land and `diff -rq` is clean before consumers start; `db:generate` → `db:migrate` is serial;
exactly one track owns `server/src/modules/index.ts`; parallel writers in one package need
worktree isolation or they queue.

**Cheap gate, no extra tokens:** read each implementer's `## Plan coverage` table. A step
marked `skipped` or `partial` is dealt with **now** — one repair round, or the user's call —
not after you have paid for review.

**Tests are the implementer's job in this pipeline.** `test-writer` is not part of this run
(see below), so any step whose plan entry names a test to add or extend is expected to come
back with that test written and passing. A behavioural step that lands with no test is a
gap: record it in the run log under *Open at the end* rather than letting it pass silently.

Record deviations and follow-ups in the log.

## Stage 2 — review, in parallel

Three lenses, launched together, all read-only, all over the same settled diff:

| Lens | What it answers | Why it cannot be merged into another |
|---|---|---|
| `architecture-reviewer` | did we cross one of the repo's boundaries B1–B11 | drops anything outside them **by design** — it does not look for bugs |
| `/code-review` | is the code correct — logic, edge cases, simplification | the boundary reviewer is forbidden from reporting this |
| `/security-review` | authz, input handling, secrets, tenancy leaks | `implementer` uses the `security` skill as a guardrail while writing, which is not a review |

Expecting `architecture-reviewer` to catch a logic error is the most common way this
pipeline lets one through. Run all three.

**Triage every finding into the run log** before fixing anything:

- **blocker** — wrong behaviour, security hole, or a crossed boundary → fix this round
- **major** — real defect, contained → fix this round
- **minor** — style, naming, a nicety → **follow-up, not a fix**; scope creep in a fix round
  is how a clean run turns into an unreviewable diff
- **contested** — the implementer disagrees with evidence → **the user decides**, never
  auto-fixed and never silently dropped

Findings tagged `Pre-existing` by the reviewer do not enter the loop. They go to the log.

## Stage 3 — the fix loop (bounded: **2 rounds**)

Review findings are not a plan, and `implementer` refuses to work without one. So build the
plan for it — a **Fix Brief** — and pass that as the plan for the round:

```markdown
# Fix Brief — round N
## F1 — <finding title>
- **Source:** architecture-reviewer B4 / code-review / security-review
- **Evidence:** `file:line` or the command that reproduces it
- **Severity:** blocker | major
- **Done when:** <the observable condition that closes it>
- **Out of scope:** everything not listed here — no refactors, no renames, no "while I'm here"
```

Then, each round:

1. `implementer` executes the Fix Brief. It may **push back with evidence** on a finding it
   believes is wrong — that answer moves the finding to `contested`, it does not get fixed
   quietly.
2. A finding that was a **real defect** gets a regression test in the same round, written by
   the implementer. A crossed boundary usually needs none.
3. **Re-review the delta only** — the diff of this round, by the reviewers that actually
   produced findings. Re-running all three over the whole change every round is the second
   biggest token sink here, after unscoped test runs.
4. Update every finding's **Outcome** in the log: `fixed` / `contested` / `deferred`.

**Exit conditions**, in order:

- no `blocker` or `major` remains → Stage 4
- round 2 finished with findings still open → **stop and ask the user**: accept as
  follow-ups, spend another round, or abandon
- a new finding contradicts the plan's design → that is a **planning** problem: stop and
  send it back to `/plan` rather than patching around it
- the same finding survives two fix attempts → stop. A third attempt means the finding or
  the design is wrong, and neither is fixed by trying harder.

## Stage 4 — verification

`plan-verifier` against the plan. It is the only stage that re-runs the plan's full
verification table, and it checks the **acceptance criteria carried from the spec** — where
spec compliance is actually proven, since a plan step can be done while the AC it existed
for still fails.

- `not verified` rows → one more Stage 3 round if fixable, otherwise the user's call
- `cannot tell` rows → surface them with what would settle each. An integration suite that
  self-skipped without Docker is `cannot tell`, never `verified` — do not let it read as a
  pass.

## Stage 5 — land

1. `doc-writer` if the user asked for it at Stage 0.
2. **`engineering-insights` once, by you**, from the `## Insight candidates` sections the
   agents emitted. They were told not to write it themselves: parallel tracks appending to
   one append-only file collide.
3. Commit per the Stage 0 policy. Never push, never open a PR unless asked.
4. Final report — the run log, plus what is still open and who owns it.

---

## Not in this pipeline, on purpose

- **`test-writer` is off** to save tokens. Coverage therefore rides on the plan's steps and
  the implementer. When a run ends with behavioural changes and no new test, say so in the
  final report — a quiet coverage gap is worse than an acknowledged one. Run the agent
  manually when a change deserves a proper suite.
- **`specreator` and `implementation-planner` are off** — they are invoked by hand through
  `/spec` and `/plan`, and this command never substitutes for either.

## Rules that hold across the whole run

- **Never let a stage silently absorb another's job.** No planning during implementation, no
  fixes during review, no design decisions anywhere.
- **Every stage's failure is reported as a failure**, with the real output, against the
  Stage 0 baseline.
- **Stop and ask** rather than looping when the loop stops converging. Two rounds is the
  budget; a third is a decision, not a default.
- **If the context is running out, stop at a stage boundary**, write the log, and tell the
  user to resume with `/impl --resume <feature>`. A half-finished stage is worse than a
  clean pause.
