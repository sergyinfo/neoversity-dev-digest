# Plan — `pr-self-review` skill

Draft, 2026-08-02. Not built. Open decisions at the end need answers first.

---

## 1. What it does

Before a PR is opened, review the **local working diff** against the repo's own skills —
routing each changed file to the skills that govern it — and refuse to proceed when a
CRITICAL finding survives.

Trigger: manually (`/pr-self-review`), and automatically before `gh pr create`.

## 2. The honest constraint about "blocking the merge"

A skill cannot block a merge. Being precise about this up front decides the whole design.

There are three separate gates, and they cover different things:

| Gate | Blocks what | Blocks whom | Mechanism |
|---|---|---|---|
| **A. In-session hook** | The agent running `gh pr create` / `gh pr merge` | Claude Code only | `PreToolUse` hook → `permissionDecision: "deny"` |
| **B. Local git hook** | `git push` from this machine | Anyone on this checkout | `.git/hooks/pre-push` (not installed today) |
| **C. GitHub branch protection** | The actual merge button | Everyone, everywhere | Required status check from a workflow |

**Only C truly blocks a merge.** A and B are local gates — if you type `gh pr create`
yourself in a terminal, no hook fires; if you merge in the GitHub UI, nothing local is
consulted.

The user's stated intent — *"перевіряти локальні зміни перед відкриттям pull request"* —
is squarely A. Recommendation: **build A now, note B as a cheap add-on, treat C as a
separate decision**, because C means running skill review in CI, which costs model tokens
on every push and is a different economic question.

The skill must say all of this plainly rather than implying it can stop a merge.

## 3. Positioning against what already exists

Claude Code ships `/code-review` (working diff) and `/security-review` (pending changes).
This skill must not be a third generic reviewer.

**The differentiator: those review code against general knowledge. This one reviews code
against *this repo's own documented conventions.*** A bundled reviewer does not know that
`routes.ts` must not import `db/`, that `$inferSelect` must not cross a repository
boundary, or that container/presentational is banned here.

So the split is:

- `/code-review` — is this code correct?
- `/security-review` — is this code safe?
- `/pr-self-review` — **does this code obey the rules we wrote down**, plus do the deterministic gates pass?

The skill should explicitly recommend running `/code-review` alongside, not instead.

## 4. Routing map: changed path → skills

Built from the actual repo layout. Order matters — most specific first.

| Path pattern | Skills to apply |
|---|---|
| `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**` | `onion-architecture`, `fastify-best-practices`, `typescript-expert` |
| `server/src/db/schema/**`, `server/src/db/migrations/**` | `postgresql-table-design`, `drizzle-orm-patterns` |
| `server/src/**/repository*.ts` | `drizzle-orm-patterns`, `onion-architecture` |
| `server/src/vendor/shared/contracts/**` | `zod`, `onion-architecture` (+ flag: two vendored copies must move in lock-step) |
| `client/src/app/**` | `next-best-practices`, `frontend-ui-architecture`, `react-best-practices` |
| `client/src/**/*.tsx` (non-test) | `react-best-practices`, `frontend-ui-architecture` |
| `client/src/**/*.test.tsx` | `react-testing-library` |
| `client/src/lib/**`, `client/src/components/**` | `frontend-ui-architecture`, `react-best-practices` |
| `reviewer-core/**` | `typescript-expert` (cite as clean-core reference; not governed by onion rules) |
| `e2e/specs/**` | none — flow files; check the seed-coupling trap instead (see §6) |
| any `*.ts`/`*.tsx` | `typescript-expert` |
| anything touching auth, secrets, tokens, `process.env`, SQL construction | `security` |

**Excluded from routing:** `engineering-insights` and `mermaid-diagram` are not review
skills. `zod` applies only where schemas are defined, not everywhere Zod is imported.

**Efficiency note:** loading 6 skills for a 3-file diff is wasteful — each stays in context
for the rest of the session. The skill should load only the skills its routing actually
selected, and cap at ~4 for a small diff.

## 5. What counts as a blocking finding

This is the part that decides whether the gate gets used or disabled.

### Two classes of signal, treated differently

**Deterministic — block immediately, no judgement needed:**

| Check | Command | Blocking condition |
|---|---|---|
| Typecheck | `pnpm typecheck` in each touched package | any error |
| Unit tests | `pnpm test` (client), `vitest --exclude '**/*.it.test.ts'` (server) | any failure |
| Architecture lint | `cd server && pnpm lint:arch` | any `error`, **or any increase over the 16-warning baseline** |
| Integration tests | `vitest .it.test` | any failure — but slow, so opt-in |

The `lint:arch` baseline rule matters: warn-level rules record migration state, so a *new*
warn violation is a regression even though the exit code is 0.

**Model findings — verify before blocking.** A skill-compliance finding is a judgement. A
gate that false-positives gets bypassed within a week, and then it protects nothing. So:

- Every candidate CRITICAL gets a second, adversarial pass: *"try to refute this — is the rule actually violated, in this exact file?"*
- Only findings that survive refutation block.
- Findings that fail refutation are reported as advisory, not dropped silently.

This mirrors the lesson already learned in `onion-architecture`: a rule with many
reasonable-looking violations is a wrong rule, not a dirty codebase.

### The severity problem — a prerequisite, not a detail

**Only 7 of 13 skills define a severity taxonomy.** Of the 11 that are review-capable,
four cannot currently produce a "CRITICAL" at all:

| Skill | Has severities? |
|---|---|
| `react-best-practices` | ✓ CRITICAL / HIGH / MEDIUM |
| `onion-architecture` | ✓ via lint `error` / `warn` |
| `security`, `postgresql-table-design`, `zod`, `typescript-expert`, `react-testing-library` | ✓ |
| **`frontend-ui-architecture`** | ✗ |
| **`next-best-practices`** | ✗ |
| **`fastify-best-practices`** | ✗ |
| **`drizzle-orm-patterns`** | ✗ |

Without a shared vocabulary the gate is arbitrary. **Prerequisite work: add a severity
tier to those four**, using the same three levels as `react-best-practices` so one scale
covers everything.

For `frontend-ui-architecture` the CRITICAL set is small and obvious — cross-feature
import, `'use client'` in a root layout, business logic importing React. Most of its rules
are MEDIUM by nature, which is itself worth knowing: **structure violations are rarely
merge-blocking.**

Expect the honest outcome that most CRITICALs will come from `security`,
`onion-architecture` and `react-best-practices`, and that the architecture skills mostly
produce advisory findings. The gate should be designed around that rather than pretending
every skill is equally load-bearing.

## 6. Repo-specific traps worth hard-coding

Cheap deterministic checks that have already bitten in this repo:

- **Seed ↔ e2e coupling.** Changing `server/src/db/seed.ts` without touching `e2e/specs/04-pr-findings.flow.json` broke CI once. If the diff touches the seed's findings, warn.
- **Vendored contracts.** `server/src/vendor/shared/` and `client/src/vendor/shared/` are two hand-maintained copies. If one changes and the other does not, flag it — with the documented exception that `GitClient` is intentionally server-only.
- **Do-not-touch paths.** `server/src/vendor/shared/`, `server/src/db/migrations/` — changing them without an explicit note is a block-worthy signal.
- **Migrations.** A `db/schema/*.ts` change with no new `db/migrations/*.sql` means `db:generate` was not run.
- **New skill files.** `.claude/skills/**` is re-included in `.gitignore` against a global ignore rule — verify new skill files are actually staged, since they silently were not before.

These are worth more per token than any model reasoning, because they are exact.

## 7. Proposed structure

```
.claude/skills/pr-self-review/
├── SKILL.md              the procedure: collect diff → route → run gates → verify → verdict
├── README.md             sources + decisions
└── reference/
    ├── routing.md        the path → skill map, with rationale
    ├── gates.md          deterministic checks, commands, baselines
    └── traps.md          the repo-specific checks in §6

.claude/hooks/pr-self-review-gate.sh    reads the last verdict, denies gh pr create/merge
.claude/settings.json                   PreToolUse wiring
```

### Procedure in SKILL.md

1. **Collect the diff.** `git diff` (unstaged) + `git diff --cached` + commits since the base branch. Fail loudly if the working tree is clean — nothing to review.
2. **Route.** Map changed paths to skills via `reference/routing.md`. Report which skills were selected and which were skipped, so the routing is auditable.
3. **Run deterministic gates first.** They are cheap and objective; if typecheck fails there is no point spending tokens on skill review.
4. **Load the selected skills** and review only the changed hunks against them.
5. **Verify candidate CRITICALs** adversarially.
6. **Verdict** — one of:
   - `PASS` — proceed.
   - `PASS WITH ADVISORIES` — non-blocking findings listed.
   - `BLOCKED` — one or more verified CRITICALs, or a failed deterministic gate. Each with file:line and the rule violated.
7. **Write the verdict** to `.claude/.pr-review-verdict.json` (gitignored) with a commit sha, so the hook can read it and so a stale verdict cannot pass a changed tree.

### The hook

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "if": "Bash(gh pr create *)",
        "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/pr-self-review-gate.sh"
      }]
    }]
  }
}
```

The script exits 0 with `permissionDecision: "deny"` and a reason when the stored verdict
is `BLOCKED` **or** missing **or** its sha does not match `HEAD`. Same wiring can cover
`gh pr merge *`.

Staleness matters more than it looks: a verdict from three commits ago is worse than no
verdict, because it looks like a pass.

## 8. Open decisions

**1. Does a stale or missing verdict block, or just warn?** Blocking is safer but means
every `gh pr create` requires a review run first, including for a one-line typo fix.
Proposal: **block, with a documented `--skip-review` escape that the hook logs.** An escape
hatch that is recorded beats one that is invented.

**2. Do we add layer C (GitHub branch protection)?** True merge-blocking needs a required
status check. The deterministic half (typecheck, tests, `lint:arch`) could run in CI today
at zero model cost. The skill-review half would cost tokens per push. Proposal: **add the
deterministic half to CI as a required check; leave skill review local.**

**3. Which four skills get severity tiers, and who writes them?** This is prerequisite
work, roughly an hour. Proposal: **do it as part of building this skill**, since the gate
is meaningless without it.

**4. Scope of the diff.** Working tree only, or everything since the base branch? A PR
contains commits, so base-branch diff is the honest scope — but that re-reviews already
reviewed commits. Proposal: **review the full base-branch diff, and cache verdicts by sha
so unchanged commits are not re-reviewed.**

**5. What about `/code-review`?** Proposal: **the skill recommends it but does not invoke
it**, to keep one clear responsibility and avoid doubling token cost per run.

## 9. Risks

- **False positives kill it.** The single largest risk. Mitigated by the adversarial verify step and by keeping most architecture findings advisory rather than blocking.
- **Token cost per run.** A large diff × 4 loaded skills is not cheap. Mitigated by running deterministic gates first and capping the number of skills loaded.
- **The gate is only as good as the routing.** If a path is unmapped, the file is reviewed by nothing. The skill should report unmapped paths as a finding in itself.
- **It cannot stop a human.** Stated up front in §2 so nobody assumes protection that is not there.
