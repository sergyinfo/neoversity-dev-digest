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
| 2 | Review ×3 | **done** | boundary: 1 major · correctness: 3 major, 3 minor · security: **1 BLOCKER**, 1 major, 5 minor |
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
| C1 | code-review | **major** | The projection can never apply the cross-repo skip. `service.ts:250` passes `att.repoId` as `reviewRepoId`, so `readAttachment`'s guard at `:286` is `x !== x` — permanently false. A multi-repo agent's projection injects documents the run skips, so AC-26's "agree exactly" fails. Root cause is structural: the projection endpoint takes no repo | 1 | open |
| C2 | code-review | **major** | No dedupe in `resolveForAgent` (`repository.ts:234-243`). The partial unique indexes are per target kind, so a document attached directly **and** via an enabled skill arrives twice, is rendered twice into the prompt, and pays the budget twice — possibly pushing a different document out. `usageCounts` dedupes this exact case for display, so the page says 1 while the run sends 2. Knock-ons: a React duplicate `key`, and `specsReadFor`'s path-keyed reason map overwriting one cause with another | 1 | open |
| C3 | code-review | **major** | `attachedPaths` ignores `repo_id` (`AgentsTab.tsx:35-38,63`, `SkillsTab.tsx:26-29,71`); the server lists attachments by workspace and target only. Two repos with the same path: the toggle renders on for a document that is not attached here, and detaching removes **the other repository's** attachment. One predicate fixes it | 1 | open |
| C4 | code-review | minor | `usageCounts` splits its composite key on the **first** space (`repository.ts:282-287`), and paths may contain spaces. `docs/my notes.md` parses as `docs/my`, so a document in use renders "—" and a phantom bucket appears | 1 | open |
| C5 | code-review | minor | The seeded trace writes `sectionText` into `prompt_assembly.specs`, which includes the heading; a real run's `assembly.specs` does not. The demo artefact shows the exact heading-vs-`assembly.specs` conflation BQ-1 exists to prevent | 1 | open |
| C6 | code-review | minor | `SkillsTab` computes a null contribution then renders `(contribution ?? 0)`, so "no attachments" and "estimates unmeasurable" both read as **0 tokens** — the `any` flag is dead code | 1 | open |
| **S1** | **security-review** | **BLOCKER** | **The read gate enforces containment but not the allow-list.** The `.md` filter, the doc-directory allow-list and `EXCLUDED_DIRS` live **only inside `walkDir`**; neither `attach()` (`service.ts:113-177`) nor `readDoc()` (`discovery.ts:195-220`) applies any of them. Proved by executing the real module: `readDoc('.git/config')` returns `url = https://x-access-token:ghp_…@github.com/…`. That PAT is a **single global secret**, written verbatim into `.git/config` by `git clone` and never rewritten. Attach it, and on the next run it goes to the LLM provider **and** is persisted into `prompt_assembly`, which the trace drawer renders in full. `.env` and any source file read the same way | 1 | open |
| S2 | security-review | **major** | The per-target cap does not bound per-run reads. `resolveForAgent` returns the agent's 20 **plus 20 per enabled linked skill**, and `linkSkill` is an unbounded upsert — so the real ceiling is `20 × (1 + N_skills)`, every one `stat`-ed, read and **tokenized before the budget drops anything**. 100 skills ≈ 2 020 reads, ~129 MB. Fires on the run **and** on the uncached projection route | 1 | open |
| C7 | code-review | test quality | Three tests are weaker than their names: `prompt-log.test.ts` plants `slice(0,0)` — an empty string — as its "secret"; `routes-smoke.test.ts` claims to refuse a traversal path but sends `path: ''`; and `reviews.it.test.ts:750` locates the AC-26 line with a matcher that also matches the drop line, so a run **with** a drop throws a TypeError instead of failing an assertion | 1 | open |

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
