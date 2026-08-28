# Run: PR Why + Risk Brief

Started: 2026-08-27 · Branch: `lesson-5-lab` (→ `origin/lesson-5-lab/sdd-pipeline`) · Mode: **multi-agent**
Plan: `docs/plans/pr-why-risk-brief.md` · Spec: `server/specs/brief/01-pr-why-risk-brief.md` (`approved`)
Ceiling: **16** — raised from the plan's 13 at the Stage 1→2 boundary (see Decisions)

## Stages

| # | Stage | Status | Artefact / result |
|---|---|---|---|
| 0 | Intake & baseline | **done** | Tree committed clean (`4033e72`, `b5cd777`); pnpm blocker cleared; baseline green on both packages |
| 1 | Implementation (T0–T8) | **done** | all 9 tracks landed, `3c02235`…`c55d8a9` |
| 2 | Review ×3 | **in progress** | R2 boundary **pass, no crossings** · R3 correctness · R4 security, over `b5cd777..HEAD` |
| 3 | Fix loop (≤2 rounds) | pending | — |
| 4 | Verification | pending | — |
| 5 | Land | pending | — |

**Agent count: 12 / 16** — one `implementer` per track T0–T7, `doc-writer` for T8, three reviewers at Stage 2.

### Tracks

| Track | Scope | Agent | Status | Commit |
|---|---|---|---|---|
| T0 | Contract, `pr_brief` widening, migration `0013_legal_mimic.sql` | 1 | **done** | `3c02235` |
| T1 | Reference resolver `{resolved, skipped}` + `dropWholeItems`, `container.blast` | 2 | **done** | `99cc43f` |
| T2 | `grounding` / `fingerprint` / `assemble` / `provenance` | 3 | **done** | `1890b2c` |
| T3 | Repository, service, routes, `modules/index.ts`, `brief.it.test.ts` | 4 | **done** | `0b0c07d` |
| T4 | Client hook + `messages/en/brief.json` | 5 | **done** | `8065d5d` |
| T5 | `WhyRiskCard` + Overview mount + the `page.tsx` wiring line | 6 | **done** | `8d7932f` |
| T6 | Diff-viewer `focus` prop chain + `openFileFromBrief` | 7 | **done** | `f1e1e63` |
| T7 | Seed row + `e2e/specs/09-pr-brief.flow.json` | 8 | **done** | `e0bb211` |
| T8 | `doc-writer` → `INSIGHTS.md` | 9 | **done** | `c55d8a9` |

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
| — | R2 architecture-reviewer | — | **No boundary crossings.** All eleven boundaries pass; the five plan-named decisions (D-10, D-12, D-14, tenancy-before-cache, one model call) verified with citations | — | n/a |
| S1 | R4 security | minor | `review_focus[].line` is never grounded, but the system prompt and `hooks/brief.ts:59-62` both document it as if it were. `grounding.ts:130-134` filters on `entry.file` alone; `hunkRanges` already computes the ranges and discards them | 1 | open |
| S2 | R4 security | minor | The 8 000-token cap is not a cap. `dropNext` floors the file list at one, and `pr_files.patch` has no stored size cap — a PR with thousands of small hunks in one file cannot be dropped below the budget, and the call is sent anyway. REQ-4 says SHALL | 1 | open |
| S3 | R4 security | minor | Fence-close neutralisation in `reviewer-core/src/prompt.ts:31` is exact-match and case-sensitive: `</UNTRUSTED>`, `</untrusted >`, `</ untrusted>` all survive. Pre-existing shared code; this feature is a new consumer that fences whole issue bodies and whole repository documents | 1 | open |
| S4 | R4 security | minor | `assemble.ts:223-226` renders `## Referenced document: ${ref.source}` outside any fence. Near-unreachable today: `INTENT_EXTERNAL_FETCH_ENABLED` defaults false, and only resolved references render. Defence-in-depth only | 1 | open |
| S5 | R4 security | note | The seed's `sk_live_EXAMPLE_NOT_A_REAL_KEY_0000…` is fabricated and predates this branch, but is realistic enough to trip a secret scanner. House style elsewhere is the unambiguous `sk_live_xxx` | 1 | open |

### Incident — a read-only reviewer mutated the working tree

R2 (`architecture-reviewer`, whose tool set is Read/Grep/Glob/Bash) ran `git stash -u` while
probing a pre-diff baseline. That reverted `docs/plans/pr-why-risk-brief.run.md` to its
committed Stage-0 state mid-run; the orchestrator's next edit then applied against the
reverted file, so the pop conflicted and the agent **dropped the stash**, discarding every
run-log update from T3 onward.

Recovered in full from the dangling stash commit `54032a3`
(`git fsck --unreachable --no-reflog` → `git show 54032a3:<path>`), then the final edits were
re-applied. Nothing under review was touched and no source file was affected — the blast
radius was exactly this file.

**The lesson is not "be careful".** A read-only mandate stated in prose is not a read-only
mandate: `architecture-reviewer` holds `Bash`, and `Bash` can write. Either the reviewer
agents lose `Bash` for a constrained inspection tool, or a `PreToolUse` hook must refuse
mutating `git` verbs (`stash`, `checkout`, `reset`, `restore`, `clean`) for read-only agents.
Recorded for `/retro`.

## Decisions

| Gate | Question | Answer |
|---|---|---|
| Stage 0 | Dirty tree (12 files) before start | Commit first — two commits: pipeline (`4033e72`), spec + plan + cross-review (`b5cd777`). Also satisfies the course criterion that spec and plan land before feature code |
| Stage 0 | pnpm 9 vs. pnpm-10 workspace files | Upgrade the local pnpm to 10 via corepack; no repository change |
| Stage 0 | Execution mode | Multi-agent (from `--mode multi`; the plan's recommendation) |
| Stage 0 | Agent ceiling | 13 (from `--max-agents 13`; the plan's counted envelope) |
| Stage 0 | Commit policy | **Per track** — a green track is committed before the next starts, so a bad fix round or review has somewhere to roll back to |
| Stage 0 | `doc-writer` at the end | **Yes** — track T8, already inside the ceiling |
| Stage 1 → 5 | Who appends to `INSIGHTS.md`: the plan gives it to T8, `/impl` Stage 5 gives it to the orchestrator | **T8 owns it.** The orchestrator-owns rule exists because parallel tracks appending to one append-only file collide; T8 runs alone after every writing track, so the collision cannot happen. Stage 5 therefore does **not** run `engineering-insights` again — that would double-append |
| Stage 1 → 2 | Agent ceiling: 9 spent, and Stage 2 + Stage 4 as specified need exactly the remaining 4, leaving fix rounds unfunded | **Raise the ceiling to 16** — 3 reviewers + `plan-verifier` + 2 fix rounds. A review budget that cannot pay for the fixes it produces buys nothing |
| Stage 2 | `/code-review` and `/security-review` are built-in commands the user runs, not agents the orchestrator can spawn | **Spawn two agents instead** — a correctness lens and a security lens with the `security` skill, each with a narrow brief and told what the other two are covering. Weaker than the built-ins, and it costs budget; recorded so the difference is not lost |
| T8 | `e2e/INSIGHTS.md` is outside the plan's file set for T8 | **Granted.** Two of T7's findings are purely about the e2e runner; filing them under `server/` buries them where nobody working on flows looks |

## Deviations and follow-ups recorded by the tracks

| # | Track | Item |
|---|---|---|
| 1 | T2 | `serializeFingerprint` / `parseStoredFingerprint` added beyond the plan — two bare digests cannot name *which* input moved, which REQ-14 requires |
| 2 | T4 | i18n keys renamed: `block.what` / `block.why` / `riskLevel.label` / `outOfDate.label`. next-intl forbids a key being both a leaf and a parent, so the plan's flat names were unusable |
| 3 | T5 | `OverviewTab.test.tsx` added (not in the plan's file set) — S16 names a test and no `OverviewTab` suite existed to extend |
| 4 | T5 | `MOVED_INPUT_LABEL` is hard-coded English: `brief.json` ships `outOfDate.moved` taking a pre-rendered `{inputs}` string and has no per-input keys. Should become eight `outOfDate.input.*` keys next time that file is opened |
| 5 | T5 | `generated_at`, `references_used` and `references_skipped` are unrendered. The plan's footer list is closed, but a reader currently cannot see that a linked document was dropped |
| 6a | T3 | Linked-issue `state` is `null` — the resolver returns `title\n\nbody` and has no `state` field; a second GitHub call on the assemble path was not worth it. The remote fingerprint digests the issue text, so an edited issue still moves it |
| 6b | T3 | An unparseable stored fingerprint yields `out_of_date: true` with `moved_inputs: []`; a null `generated_at` is served as the epoch, because an empty string reaches the card as `Invalid Date` |
| 6c | T3 | `MockLLMProvider`'s constructor types `id` as `'openai' \| 'anthropic'` while three suites pass `'openrouter'` — harmless only because server tests are not typechecked |
| 6d | T3 | The two pre-existing 5/min overrides (`intent`, `blast/summary`) still have no 429 assertion; `brief.it.test.ts` now shows the pattern that would cover them |
| 6 | T5 | `brief.json`'s `fileCapped` and `partialCaveat` have no reader and no field in `BriefResponse` to drive them — contract or copy needs a decision |
| 7 | T6 | The `page.tsx` → `OverviewTab` wiring line belonged to no track under barrier 5. Assigned to T5 explicitly once T6 was committed; without it `openFileFromBrief` would have shipped dead |

### T7 — two items that need a decision, not a fix

| # | Item |
|---|---|
| A | **AC-28 has no e2e fixture.** The seed creates exactly one PR (#482), and S18 gave it a brief — so no seeded PR is left without one. T7 dropped the AC-28 assertion rather than invent a second demo PR, which S18 does not authorise. The empty state *is* covered by `WhyRiskCard.test.tsx` at unit level. Options: accept unit-only coverage, or add a plan step seeding a second no-brief PR |
| B | **`./scripts/e2e.sh` gives 5/8 locally, and it is pre-existing.** `04`, `05` and `09` all fail on the same `find text … click` step. T7 stashed its own changes and reproduced the identical failure on `04`/`05` against the unmodified tree. Cause: a real GitHub PAT in `~/.devdigest/secrets.json` (outside the repo) makes every PR-list load do a ~1 s doomed call to `api.github.com`, and `find` does not poll the way `wait` does. CI has no PAT. **Flow `09` passed twice end to end when isolated with a throwaway `wait` that was deliberately not committed** — so the committed flow is unproven as part of a full local run, and CI is what settles it |

## Open at the end

*(Stage 1 nearly done — T8 outstanding, then Stages 2–5.)*
