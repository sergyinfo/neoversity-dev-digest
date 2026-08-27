# Run: PR Why + Risk Brief

Started: 2026-08-27 · Branch: `lesson-5-lab` (→ `origin/lesson-5-lab/sdd-pipeline`) · Mode: **multi-agent**
Plan: `docs/plans/pr-why-risk-brief.md` · Spec: `server/specs/brief/01-pr-why-risk-brief.md` (`approved`)
Ceiling: `--max-agents 13` (the plan's counted envelope)

## Stages

| # | Stage | Status | Artefact / result |
|---|---|---|---|
| 0 | Intake & baseline | **done** | Tree committed clean (`4033e72`, `b5cd777`); pnpm blocker cleared; baseline green on both packages |
| 1 | Implementation (T0–T7) | pending | — |
| 2 | Review ×3 | pending | — |
| 3 | Fix loop (≤2 rounds) | pending | — |
| 4 | Verification | pending | — |
| 5 | Land | pending | — |

**Agent count: 0 / 13.**

## Baseline (pre-existing failures — never blamed on this change)

**None. Both packages were fully green before the first track started.**

| Package | Command | Result |
|---|---|---|
| server | `pnpm typecheck` | pass, no output |
| server | `pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot` | **26 files, 280 tests, all passed** (1.58 s) |
| client | `pnpm typecheck` | pass, no output |
| client | `pnpm test` | **18 files, 107 tests, all passed** (2.30 s) |

Integration (`.it.test.ts`) not run at baseline — Docker is reachable, and `plan-verifier`
owns that suite once at Stage 4 per the plan's test staging.

### Blocker cleared before the baseline could be taken

`pnpm` in `server/`, `client/` and `e2e/` failed with `ERROR packages field missing or empty`
— **every** command, including `typecheck`, `test` and `db:generate`. Cause: three tracked
`pnpm-workspace.yaml` files (committed in `74ddb66`) contain only an `allowBuilds:` key, which
is a **pnpm 10** field; the active pnpm was **9.15.9**, which reads the file as a workspace
manifest and rejects it for having no `packages:` key.

The repository was right and the environment was behind. Resolved by
`corepack prepare pnpm@10.34.5 --activate` — an environment change only. `corepack use` was
deliberately **not** used: it writes `packageManager` into `package.json` and would have put an
unrelated edit into this feature's diff. `git status` confirmed clean afterwards.

This is a pre-existing condition, not a consequence of this change, and it is exactly what a
baseline exists to surface.

## Review findings

| # | Source | Severity | Finding | Round | Outcome |
|---|---|---|---|---|---|
| — | — | — | *(none yet — Stage 2 has not run)* | — | — |

## Decisions

| Gate | Question | Answer |
|---|---|---|
| Stage 0 | Dirty tree (12 files) before start | Commit first — two commits: pipeline (`4033e72`), spec + plan + cross-review (`b5cd777`). Also satisfies the course criterion that spec and plan land before feature code |
| Stage 0 | pnpm 9 vs. pnpm-10 workspace files | Upgrade the local pnpm to 10 via corepack; no repository change |
| Stage 0 | Execution mode | Multi-agent (from `--mode multi`; the plan's recommendation) |
| Stage 0 | Agent ceiling | 13 (from `--max-agents 13`; the plan's counted envelope) |
| Stage 0 | Commit policy | **Per track** — a green track is committed before the next starts, so a bad fix round or review has somewhere to roll back to |
| Stage 0 | `doc-writer` at the end | **Yes** — track T8, already inside the ceiling |

## Open at the end

*(nothing yet)*
