---
name: pr-self-review
description: "Reviews the local diff against this repo's own skills before a PR is opened, and refuses to open one when a verified CRITICAL finding survives. Routes each changed file to the skills that govern it — onion-architecture and fastify/drizzle on server files, frontend-ui-architecture and react/next on client files — runs the deterministic gates (typecheck, tests, lint:arch), verifies candidate CRITICALs adversarially, and writes a verdict the pre-PR hook reads. Use before opening a pull request, when asked to self-review or pre-flight changes, or when the gh pr create hook reports a missing verdict. Trigger terms: self review, pre-PR check, review my changes, ready to open a PR, pr gate, blocked from opening PR, verdict."
when_to_use: "Before `gh pr create`, or on demand via /pr-self-review. Reviews compliance with THIS repo's documented conventions — run /code-review alongside for general correctness, and /security-review for security depth."
metadata:
  version: 1.0.0
  tags: review, gate, pre-pr, skills-routing, ci
allowed-tools: Read, Grep, Glob, Bash, Skill, Write
---

# PR self-review

Gate the diff before it becomes a PR.

## What this is not

It does **not** replace `/code-review` (is the code correct?) or `/security-review` (is it
safe?). It answers a third question those cannot: **does this diff obey the rules this repo
wrote down?** A bundled reviewer does not know that `routes.ts` must not import `db/`, or
that container/presentational is banned here.

Recommend `/code-review` in the summary; do not invoke it — one responsibility per run.

## What it can actually block

Be honest about this in the output. A hook denies **the agent's** `gh pr create`. It does
not stop a human typing the same command in a terminal, and it does not touch the GitHub
merge button. True merge-blocking is branch protection plus a required check — the
deterministic gates below are wired into CI for that; skill review stays local.

## Procedure

### 1. Collect the diff

```sh
git fetch origin --quiet
BASE=$(git merge-base HEAD origin/main)
git diff --name-status "$BASE"        # committed
git diff --name-status                # unstaged
git diff --cached --name-status       # staged
```

Review the **full base-branch diff**, not just the working tree — that is what the PR will
contain. If nothing differs from `origin/main`, stop and say so; there is nothing to gate.

Record `HEAD` — the verdict is stamped with it and is invalid for any other commit.

### 2. Route

Map every changed path to the skills that govern it using
[reference/routing.md](reference/routing.md).

Then report the routing before reviewing:

```
server/src/modules/pulls/routes.ts  → onion-architecture, fastify-best-practices
client/src/app/.../FindingsPanel.tsx → frontend-ui-architecture, react-best-practices
docs/research/foo.md                 → (none — not reviewed)
```

**An unmapped source path is itself a finding.** A file reviewed by nothing is worse than
one reviewed badly.

Cap at **4 skills** unless the diff genuinely spans more. Each loaded skill stays in context
for the rest of the session.

### 3. Deterministic gates first

They are cheap and objective. If typecheck fails there is no point spending tokens on skill
review. Run only what the diff touches — see [reference/gates.md](reference/gates.md).

### 4. Repo-specific traps

Exact checks that have already broken this repo once. Cheaper and more reliable than model
reasoning: [reference/traps.md](reference/traps.md).

### 5. Skill review

Load the routed skills and review **only the changed hunks** against them. Cite
`file:line` and the rule. Assign severity using the skill's own scale — all review skills
now share CRITICAL / HIGH / MEDIUM.

### 6. Verify every candidate CRITICAL

A gate that false-positives gets bypassed within a week, and then it protects nothing.

For each candidate CRITICAL, run a second, adversarial pass:

> Try to refute this. Is the rule actually violated, in this exact file, by this diff — or
> does it only look that way? Default to refuted when uncertain.

- Survives → blocking.
- Refuted → demote to advisory and **say so**, with the reason. Never drop it silently.

Do not verify HIGH/MEDIUM — they never block, so the cost buys nothing.

### 7. Verdict

One of:

- **PASS** — nothing blocking.
- **PASS WITH ADVISORIES** — HIGH/MEDIUM findings listed; PR may proceed.
- **BLOCKED** — a verified CRITICAL, or a failed deterministic gate.

Write it to `.claude/.pr-review-verdict.json` (gitignored):

```json
{
  "verdict": "BLOCKED",
  "sha": "<HEAD sha>",
  "base": "<merge-base sha>",
  "generatedAt": "<ISO>",
  "skills": ["onion-architecture", "react-best-practices"],
  "gates": { "typecheck": "pass", "tests": "pass", "lintArch": "16 warn / 0 error (baseline)" },
  "blocking": [
    { "file": "server/src/modules/pulls/routes.ts", "line": 143,
      "skill": "onion-architecture", "rule": "no-sql-in-routes",
      "why": "…", "verified": true }
  ],
  "advisories": [ … ]
}
```

The sha stamp is load-bearing: **a verdict from an older commit is worse than none**,
because it looks like a pass. The hook re-checks it against `HEAD`.

## Output

Lead with the verdict, then the blocking findings, then advisories, then what was skipped
and why. State the routing so the user can see what was and was not reviewed.

If BLOCKED, say exactly what must change — not "consider refactoring".

## Escape hatch

`/pr-self-review --skip-review` writes a verdict of `SKIPPED` with a reason and a
timestamp. The hook allows it and the record stays in the file.

An escape that is recorded beats one that gets invented — without it, the first person in a
hurry deletes the hook.

## Reference

- [reference/routing.md](reference/routing.md) — path → skill map.
- [reference/gates.md](reference/gates.md) — deterministic checks, commands, baselines.
- [reference/traps.md](reference/traps.md) — repo-specific exact checks.
- [README.md](README.md) — design decisions and limits.
