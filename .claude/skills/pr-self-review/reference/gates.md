# Deterministic gates

Objective, cheap, and blocking without judgement. Run these **before** loading any skill —
if typecheck fails there is nothing to review yet.

Run only what the diff touches.

## Server — `server/**` changed

```sh
cd server
pnpm typecheck                                   # any error → BLOCKED
pnpm exec vitest run --exclude '**/*.it.test.ts' # any failure → BLOCKED
pnpm lint:arch                                   # see baseline below
```

Integration tests (`pnpm exec vitest run .it.test`) take ~20s and need Docker. Run them
when the diff touches `db/`, a repository, or a migration; otherwise skip and say so.

## Client — `client/**` changed

```sh
cd client
pnpm typecheck    # any error → BLOCKED
pnpm test         # any failure → BLOCKED
```

## reviewer-core / e2e

```sh
cd reviewer-core && npm test        # uses npm, not pnpm
cd e2e && npm run typecheck         # uses npm, not pnpm
```

`e2e` has no local runner — `agent-browser` is not installed by default, so browser flows
are CI-only. Do not attempt them locally; note them as deferred to CI.

## The `lint:arch` baseline

`pnpm lint:arch` exits 0 today because rules with outstanding violations sit at `warn`.
**Exit code alone is not the gate.**

Baseline at the time of writing: **16 warnings, 0 errors.**

| Condition | Verdict |
|---|---|
| Any `error` | BLOCKED |
| Warning count > 16 | BLOCKED — a new violation of a warn-level rule is a regression |
| Warning count ≤ 16 | pass; if lower, say so and suggest promoting that rule to `error` |

Counting:

```sh
cd server && pnpm lint:arch 2>&1 | grep -oE '\([0-9]+ errors?, [0-9]+ warnings?\)'
```

Severity in that config records **migration state, not permission**. That is the whole
reason the count matters more than the exit code.

If the baseline is intentionally changed, update it here and in
`.claude/skills/onion-architecture/SKILL.md` in the same PR.

## Package manager trap

`server` and `client` use **pnpm**; `reviewer-core` and `e2e` use **npm** (they have
`package-lock.json`). Running `pnpm` in `e2e` creates a stray `pnpm-lock.yaml` and a
`pnpm-workspace.yaml` — this has already happened once in this repo. Use the right one.

## Reporting

State every gate that ran, its result, and every gate skipped with the reason. A gate
silently not run reads as a pass.
