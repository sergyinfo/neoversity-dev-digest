# Run: Project Context

Started: 2026-08-29 · Branch: `lesson-5-lab` · Mode: **multi-agent**
Plan: `docs/plans/project-context.md` (amended after cross-review, `a8273db`)
Spec: `server/specs/project-context/01-project-context.md` (`approved`)
Ceiling: **12** — the plan's counted envelope of 11, plus `doc-writer` added at Stage 0

## Stages

| # | Stage | Status | Artefact / result |
|---|---|---|---|
| 0 | Intake & baseline | **done** | Tree clean at `a8273db`; baseline captured before anything changed, all green |
| 1 | Implementation (T0–T6) | **done** | all 7 tracks landed, `55a1639`…`aa7bf6c` |
| 2 | Review ×3 | **in progress** | boundary: **1 major** · correctness and security running |
| 3 | Fix loop (≤2 rounds) | pending | — |
| 4 | Verification | pending | — |
| 5 | Land | pending | — |

**Agent count: 10 / 15** — ceiling raised from 12 at the Stage 1→2 boundary so the fix rounds are funded.

### Tracks

| Track | Scope | Model | Agent | Status | Commit |
|---|---|---|---|---|---|
| T0 | `SpecFile` +3 optional fields, mirrored; module-local contracts | opus | 1 | **done** | `55a1639` |
| T1 | Attachment table + generated migration + constraint test | opus | 2 | **done** | `c38e5bc` |
| T2 | Discovery, assemble, repository/service, routes, registry, run injection | opus | 4 | **done** | `d76b0bc` |
| T3 | Client hooks, i18n, nav, `ProjectionSummary` | sonnet | 3 | **done** | `d413a0a` |
| T4 | `/context` page + `AgentEditor` Context tab | sonnet | 5 | **done** | `06a3e03` |
| T5 | Trace drawer tests (no implementation) | sonnet | 6 | **done** | `da8999b` |
| T6 | e2e flow 08 + fixture clone + seed + INSIGHTS | sonnet | 7 | **done** | `aa7bf6c` |

## Baseline (pre-existing failures — never blamed on this change)

**None. Every gate was green before the first track started.**

| Package | Command | Result |
|---|---|---|
| server | `pnpm typecheck` | pass, no output |
| server | `vitest run --exclude '**/*.it.test.ts'` | **31 files, 408 tests**, all passed |
| server | `vitest run .it.test` (with `DOCKER_HOST`) | **9 files, 66 tests**, all passed — ran, not skipped |
| client | `pnpm typecheck` | pass, no output |
| client | `pnpm test` | **21 files, 143 tests**, all passed |
| reviewer-core | `npm run typecheck` | pass — this is the "it was not modified" baseline |
| — | `diff -rq server/src/vendor/shared client/src/vendor/shared` | prints nothing |

The integration baseline matters here: the plan adds an `.it.test` in T1, and under OrbStack
these suites **fail rather than skip** without `DOCKER_HOST`. Knowing 66/66 passed today is
what makes a later failure attributable.

## Review findings

| # | Source | Severity | Finding | Round | Outcome |
|---|---|---|---|---|---|
| A1 | architecture-reviewer B3 | **major** | `run-executor.ts:19,289` imports and constructs `ProjectContextService` directly instead of reaching it through the container, the way `repoIntel`, `intent` and `blast` all are. Costs the `ContainerOverrides` injection seam every sibling capability has, makes `reviews` depend on a concrete class in another module, and its justifying comment cites the wrong precedent — the `intent/block.js` import above it is justified as a **leaf** (contract types only), while `project-context/service.ts` imports the container and is not one | 1 | open |

## Decisions

| Gate | Question | Answer |
|---|---|---|
| Pre-run | Plan amended after cross-review before starting | Yes — three findings (F1 unique-index NULL semantics, F2 inert allow-list entry, F3 clone path set but missing) were resolved in the plan first. Starting on the unamended plan would have had T1 generate a migration whose index admits duplicates |
| Stage 0 | Execution mode | Multi-agent (from `--mode multi`; the plan's own recommendation) |
| Stage 0 | Agent ceiling | **12** — the plan counts 11 (7 tracks + 2 reviewers + 2 fix rounds); `doc-writer` is the twelfth |
| Stage 0 | Commit policy | **Per track** — a green track is committed before the next starts |
| Stage 0 | `doc-writer` at the end | **Yes**, added beyond the plan's envelope |

## Open at the end

*(nothing yet)*
