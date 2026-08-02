# Repo-specific traps

Exact checks, each earned by something that actually broke here. Worth more per token than
model reasoning, because they are deterministic.

## 1. Seed ↔ e2e coupling — CRITICAL

`e2e/specs/04-pr-findings.flow.json` asserts the literal text `"10 findings"`, which comes
from the seeded review in `server/src/db/seed.ts`. Changing the seed's findings without
updating the flow breaks `browser flows` in CI — this has happened.

```sh
git diff --name-only "$BASE" | grep -q 'server/src/db/seed.ts' \
  && ! git diff --name-only "$BASE" | grep -q 'e2e/specs/04-pr-findings' \
  && echo "TRAP: seed changed, e2e flow not updated"
```

Only fires when the **findings or review** part of the seed changed; agent or settings edits
are harmless.

## 2. Vendored contracts must move in lock-step — CRITICAL

`server/src/vendor/shared/` and `client/src/vendor/shared/` are two hand-maintained copies
resolved by tsconfig alias, not a published package. A field added to one and not the other
compiles on one side and fails on the other.

```sh
git diff --name-only "$BASE" | grep -c 'server/src/vendor/shared/contracts'
git diff --name-only "$BASE" | grep -c 'client/src/vendor/shared/contracts'
```

Counts should move together.

**Documented exception:** `GitClient` in `adapters.ts` is intentionally server-only — the
client copy already omits `sync` and `diffNameOnly`, and `client/src` never imports it. A
server-only change to that interface is correct and must not be flagged.

## 3. Do-not-touch paths — CRITICAL unless justified

Per root `AGENTS.md`:

- `server/src/vendor/shared/`
- `server/src/db/migrations/`

A diff touching either without an explicit note in the PR body is blocking. Both have
legitimate reasons to change; silence about it is the problem.

## 4. Schema change with no migration — CRITICAL

```sh
git diff --name-only "$BASE" | grep -q 'server/src/db/schema/' \
  && ! git diff --name-only "$BASE" | grep -q 'server/src/db/migrations/.*\.sql' \
  && echo "TRAP: schema changed, no migration generated"
```

Migrations come from `pnpm db:generate` (drizzle-kit). Never hand-written.

## 5. New skill files actually staged — HIGH

`.claude/skills` appears in at least one contributor's **global** gitignore. The repo
`.gitignore` re-includes it (`!.claude/skills/`), but a new skill silently missing from a
commit has already happened once.

```sh
git status --short --untracked-files=all .claude/skills/ | grep '^??' \
  && echo "TRAP: untracked skill files"
```

## 6. `lint:arch` baseline drift — CRITICAL

Covered in [gates.md](gates.md). Repeated here because it is the trap most likely to be
read as a pass: the command exits 0 with 16 warnings, so only the **count** reveals a
regression.

## 7. Multi-line query matching — method, not a check

Any ad-hoc measurement of Drizzle usage must be multi-line aware. Chains break across lines:

```ts
const [repo] = await container.db
  .select()          // invisible to a line-based grep
  .from(t.repos)
```

A line-based `grep` undercounted SQL-in-routes by roughly 3× in this repo. Prefer the
`dependency-cruiser` rule, which matches the **import** and is immune to formatting.

## 8. Package manager per package — HIGH

`server`/`client` are pnpm; `reviewer-core`/`e2e` are npm. A lockfile appearing for the
wrong manager is a trap:

```sh
git diff --name-only "$BASE" | grep -E '(e2e|reviewer-core)/pnpm-lock.yaml|pnpm-workspace.yaml' \
  && echo "TRAP: pnpm artifacts in an npm package"
```
