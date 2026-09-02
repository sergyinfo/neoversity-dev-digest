# Retro ledger

Retrospectives on **how the SDD pipeline performed** — the spec → plan → implement → review →
verify chain itself, not the code it produced. Written by `/retro`, which runs **only when a
human types it**; nothing invokes it automatically.

**Scope boundary:** findings about the codebase — gotchas, conventions, library quirks — do
not belong here. They go to `<package>/INSIGHTS.md` via the `engineering-insights` skill. A
finding in the wrong home is lost to the reader who needs it.

**Append-only.** Newest entry first. An entry is never rewritten or deleted, including by the
run that wrote it — the record of what was proposed and declined is the point.

Each entry opens by checking the previous entry's proposals: were they applied, and did they
help? A ledger whose proposals nobody checks is a diary.

---

<!-- entries below, newest first -->

## 2026-08-29 — two full pipeline runs: PR Why + Risk Brief, and Project Context

**Mode:** context · **Period:** 2026-08-27…2026-08-29 · **Read:** this session's own record — every agent report, the decisions relayed to the user, and what had to be redone. No artefacts re-opened; `deep` was not requested.

### Previous proposals

**None — this is the first entry.** The ledger has existed since the `/retro` command was written and has never been run, so there is nothing to check. That absence is itself the first observation: a command that is never invoked is indistinguishable from one that does not exist.

### Observations

| # | Observation | Kind | Evidence |
|---|---|---|---|
| 1 | **A credential-exfiltration blocker survived the spec, the plan, a cross-model review and seven implementation tracks.** The allow-list was enforced only inside the directory walk while three gates fed the model; `readDoc('.git/config')` returned the clone URL with the GitHub PAT embedded. Every stage was green, and the tests covering it were green, because they covered traversal only. No single plan step owned the sentence "the allow-list applies at every gate that feeds the model" — S4 defined the predicates, S5 owned the walk and containment, S6/S8 owned attach | silent stage | `docs/plans/project-context.run.md` finding S1; the plan's S4/S5/S8 "Done when" texts, none of which names the union |
| 2 | **The agent ceiling was exhausted at the same boundary in both runs, for the same structural reason.** The plan's cost envelope counts **two** reviewers (`plan-verifier` + `architecture-reviewer`); `/impl` Stage 2 mandates **three** lenses. Both runs reached Stage 2 with exactly enough budget for review and verification and none for the fix rounds the review would produce | weak gate | Brief run log: ceiling 13 → 16 at the Stage 1→2 boundary. Project Context run log: 12 → 15 at the same boundary. Both raises were forced, not chosen |
| 3 | **A read-only reviewer mutated the working tree and destroyed part of a run log.** `architecture-reviewer` ran `git stash -u` while probing a baseline; the pop conflicted with a concurrent orchestrator edit and the stash was dropped. Read-only is stated in that agent's prose; its tool set holds `Bash`, and `Bash` writes | wrong agent | `docs/plans/pr-why-risk-brief.run.md`, incident section. Recovered from dangling stash `54032a3` via `git fsck --unreachable` |
| 4 | **A fix round was scoped to repair correct code.** Two independent reviewers reported that a usage counter split its composite key on the first space; the separator is a raw NUL byte and the counts were already right. The orchestrator relayed the finding without re-deriving it, and the implementer lost a cycle before contesting it with evidence | rework | `docs/plans/project-context.fix-brief-2.md` F8, contested. Cause: a literal `0x00` in a `.ts` file makes `grep` print nothing and renders as whitespace |
| 5 | **Two plan steps named file sets insufficient for their own "Done when", and one "Done when" was unsatisfiable as written.** S3 could not be completed without `db/schema.ts`; S16 could not without `agents/[id]/page.tsx`; S11 required "reverts the toggle", which presumes an optimistic update the design deliberately does not perform. All three were caught downstream by implementers and the verifier, not by the plan | weak gate | `plan-verifier` report, "Plan quality notes" |
| 6 | **Cross-model review produced two findings the family that wrote the plan could not have produced.** On the brief it found the read path could not detect an edited linked issue while the spec promised it could. On Project Context it found a four-column unique index over two mutually exclusive nullable FKs is silently ineffective — the direct cost of a decision the plan had deliberately accepted, derived from SQL semantics alone by a reviewer that never saw the reasoning | worked well | Both `*.cross-review.md`. The second was then reproduced empirically on PG16 before the fix |
| 7 | **Red-before-green was enforced and repeatedly caught weak work.** Every fix round reported the failing output before its fix. Round 2 went further with an inverted proof: three tests already existed and already passed while proving nothing, so each was validated by breaking the thing it guards and watching it go red | worked well | `project-context.fix-brief-2.md` F7, with the red output quoted for each |
| 8 | **The orchestrator read a `404` as "0 documents" while verifying the demo**, and briefly believed the shipped feature was broken. A parsing script swallowed the error envelope into an empty list — the same vacuous-read failure the pipeline spent two rounds removing from its tests | silent stage | This session, verifying `GET /repos/:id/context` with a stale `repo_id` after the demo database was rebuilt |

### Proposals

| # | Change | File | Because | Cost | Expected effect | How we'd know | Grade |
|---|---|---|---|---|---|---|---|
| P1 | Remove `Bash` from `architecture-reviewer`'s tool set, or add a `PreToolUse` hook refusing mutating git verbs (`stash`, `checkout`, `reset`, `restore`, `clean`) for agents whose charter says read-only | `.claude/agents/architecture-reviewer.md`, `.claude/settings.json` | Obs. 3 — read-only asserted in prose is not read-only | The reviewer loses `git show`/`git diff` for baseline probing, which it used legitimately; a hook is the cheaper half and keeps those | No reviewer can mutate the tree | The next run's log has no incident section, and the reviewer's report still cites baseline evidence | **adopt now** |
| P2 | Make `implementation-planner`'s cost envelope count **three** review lenses, and have `/impl` refuse to start when `--max-agents` is below the envelope plus two fix rounds | `.claude/agents/implementation-planner.md`, `.claude/commands/impl.md` | Obs. 2 — the same forced raise happened twice at the same boundary | A larger declared number up front, which may read as more expensive than it is | The ceiling is set once, at Stage 0, and never renegotiated mid-run | The next run's Decisions table has no ceiling raise | **adopt now** |
| P3 | Require every Fix Brief finding to carry a **reproduction the implementer can run**, not only a `file:line` | `.claude/commands/impl.md`, Fix Brief template | Obs. 4 — a `file:line` was enough to misread a NUL as a space; a runnable reproduction would have failed to reproduce and stopped the round | Findings take longer to write, and some genuinely cannot be reduced to a command — those must say so explicitly | A finding that cannot be reproduced is contested before an implementer is spent on it | Contested findings arrive at triage, not after a fix attempt | **adopt now** |
| P4 | Add to the planner's self-check: for each step, is its **file set sufficient for its own "Done when"**, and is the "Done when" satisfiable without assuming a design the plan did not choose | `.claude/agents/implementation-planner.md` | Obs. 5 — three instances in one plan, all caught downstream | One more pass over the step list; slightly longer planning | Implementers stop discovering missing files mid-track | The verifier's "Plan quality notes" section is empty | **try once** |
| P5 | When a fix round repairs an **existing** test, require the inverted proof — break what it guards, show red, restore — rather than the usual red-before-green | `.claude/agents/implementer.md` | Obs. 7 — this was invented ad hoc in round 2 and is the only way to prove a vacuous test stopped being vacuous | Slower fix rounds when tests are involved; needs a revert-and-rerun cycle per test | A repaired test is demonstrably capable of failing | Fix-round reports quote red output for repaired tests, not only for new ones | **try once** |
| P6 | Split Stage 2 so security runs first and alone, then boundary and correctness in parallel | `.claude/commands/impl.md` | Considered for cost: three opus reviewers over a 10k-line diff is the single largest parallel spend | Delays the two cheaper lenses behind the slowest one, for no gain in what is found | — | — | **park** — the security lens found the only blocker in both runs; serialising it delays the most valuable finding, and the cost was justified |
| P7 | Have `/impl` verify its own read-backs — when the orchestrator parses an API response during verification, assert the shape rather than defaulting a missing key | `.claude/commands/impl.md` | Obs. 8 — the orchestrator committed the exact failure it spent two rounds removing from the tests | A little more ceremony in ad-hoc verification | An error envelope is never read as an empty result | No "briefly believed it was broken" moments in the next run's report | **try once** |

### Handed elsewhere

Codebase findings from this period were filed to `INSIGHTS.md` **during** the runs, by the tracks that found them — `server/INSIGHTS.md` +11 lines, `client/INSIGHTS.md` +8, both append-only.

Two findings from the retro-page work were emitted as candidates and are **not yet filed**. They belong to `engineering-insights`, not here:

- **`dist/` does not mirror `src/` in `server/`.** `tsconfig` sets no `rootDir` and the `@devdigest/reviewer-core` alias pulls `../reviewer-core/src` into the program, so tsc infers the repo root as the common root and emits `dist/server/src/…`. `package.json`'s `start` and `db/migrate.ts`'s migrations lookup are both wrong against a real build.
- **The vendored `Markdown` primitive runs without `rehype-raw`**, so raw HTML is escaped rather than dropped: an HTML comment in a source document renders on the page as its literal text.

Run `/engineering-insights` to file them — deliberately not done from here, so the two records stay under separate decisions.


