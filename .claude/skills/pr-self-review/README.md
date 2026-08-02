# pr-self-review — design notes

**Version 1.0.0** · built 2026-08-02.

## What it is

A gate that reviews the local diff against **this repo's own skills** before a PR is
opened, and refuses to open one when a verified CRITICAL survives.

The value it adds over the bundled reviewers: `/code-review` asks *is this correct?* and
`/security-review` asks *is this safe?*. Neither knows that `routes.ts` must not import
`db/`, that `$inferSelect` must not cross a repository boundary, or that
container/presentational is banned here. Those rules are written down in this repo, and
this skill is what checks them.

## The three gates, and which one this is

| Gate | Blocks what | Blocks whom | Status |
|---|---|---|---|
| **A. In-session hook** | the agent's `gh pr create` / `gh pr merge` | Claude Code only | **built** |
| **B. `pre-push` git hook** | `git push` from this checkout | anyone on this machine | not built |
| **C. Branch protection + required check** | the merge button | everyone | **partly built** — `.github/workflows/architecture.yml` exists; the branch rule must be enabled in GitHub settings |

**Only C truly blocks a merge.** A is a local pre-flight; it does nothing if a human types
`gh pr create` in their own terminal, and nothing about the GitHub UI. The skill says this
in its own output rather than implying protection it does not provide.

The split follows the approved decision: **deterministic checks go to CI** (zero model
cost, can be a required check); **skill review stays local** (costs tokens per run).

## Decisions

**1. A stale or missing verdict blocks, with a recorded escape.**
`/pr-self-review --skip-review` writes a `SKIPPED` verdict with a reason and the sha. The
hook allows it and the record persists. An escape that is documented beats one that gets
invented — without it, the first person in a hurry deletes the hook.

**2. Verdicts are stamped with a commit sha.** A verdict from an older commit is worse than
no verdict, because it reads as a pass. The hook compares against `HEAD` and denies on
mismatch.

**3. Two classes of signal, treated differently.** Deterministic gates (typecheck, tests,
`lint:arch` count) block immediately — they are objective. Model findings get an
adversarial refutation pass first, and only survivors block. A gate that false-positives is
bypassed within a week, and then it protects nothing. Refuted findings are demoted to
advisory and reported, never dropped silently.

**4. Full base-branch diff, not just the working tree.** That is what the PR will contain.

**5. Recommends `/code-review`, does not invoke it.** One responsibility per run, and no
doubled token cost.

**6. Severity tiers added to four skills as a prerequisite.** `frontend-ui-architecture`,
`next-best-practices`, `fastify-best-practices` and `drizzle-orm-patterns` had no severity
scale, so "one CRITICAL blocks" was undefined for them. All four now use the same
CRITICAL / HIGH / MEDIUM scale as `react-best-practices`.

A finding from that work worth keeping: **most `frontend-ui-architecture` rules are
MEDIUM.** Structural mistakes are cheap to fix later, so they rarely justify blocking a
merge. Expect most CRITICALs to come from `security`, `onion-architecture` and
`react-best-practices`.

## Bug found while building this

The hook was first wired with `matcher: "Bash"` plus an `if: "Bash(gh pr create *)"`
narrowing clause, as the hooks documentation describes. In practice the narrowing did not
apply, and **the gate denied every shell command in the session** — the repo was briefly
unusable.

Fixed by **deciding inside the script**: the hook reads `tool_input.command` from stdin and
returns `allow` immediately unless the command contains `gh pr create` or `gh pr merge`.
That is version-independent and fails open for everything else.

Two lessons, both now in the script's comments:

- A gate wired to a broad matcher must self-filter. Relying on the config to narrow makes an outage one syntax mismatch away.
- The filter is a substring match, so it is deliberately over-broad — `echo "gh pr create"` is gated too. That direction of error is safe (deny, not allow), and it is why the test suite constructs the command from fragments rather than writing the literal.

## Verified behaviour

All eight hook paths were tested against the real script:

| Input | Decision |
|---|---|
| `pnpm lint:arch`, no verdict | allow |
| `git push origin main`, no verdict | allow |
| `gh pr create`, no verdict | deny |
| `gh pr merge`, no verdict | deny |
| `gh pr create`, `PASS` on HEAD | allow |
| `gh pr create`, `BLOCKED` | deny |
| `gh pr create`, `SKIPPED` on HEAD | allow |
| `gh pr create`, `PASS` on an old sha | deny |
| unreadable verdict JSON | deny |

The CI baseline parser was checked against real `depcruise` output: `errors=0 warnings=16`,
matching the recorded baseline.

## Files

```
.claude/skills/pr-self-review/
├── SKILL.md                    procedure
├── README.md                   this file
└── reference/
    ├── routing.md              path → skill map
    ├── gates.md                deterministic checks and the lint:arch baseline
    └── traps.md                repo-specific exact checks

.claude/hooks/pr-self-review-gate.sh    PreToolUse gate
.claude/settings.json                   hook wiring
.github/workflows/architecture.yml      the CI half (candidate required check)
```

`.claude/.pr-review-verdict.json` is gitignored — per-checkout state.

## Known limits

- **It cannot stop a human.** Stated in the skill's own output.
- **Routing is the weak point.** A path absent from `reference/routing.md` is reviewed by nothing, which looks identical to a clean review. The skill reports unmapped source paths as a finding to make that visible, but the table still needs updating whenever a skill is added.
- **Token cost scales with diff size × skills loaded.** Mitigated by running deterministic gates first and capping at four skills.
- **The `lint:arch` baseline is duplicated** in `gates.md`, `onion-architecture/SKILL.md` and `architecture.yml`. Three places to update when it moves; the workflow prints a notice when the count drops to prompt exactly that.

## To finish setup

Enable branch protection on `main` in GitHub settings with **architecture / boundaries**
as a required status check. Without that step, gate C is a workflow that reports but does
not block.
