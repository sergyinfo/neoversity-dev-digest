# Run: PR Why + Risk Brief

Started: 2026-08-27 · Branch: `lesson-5-lab` (→ `origin/lesson-5-lab/sdd-pipeline`) · Mode: **multi-agent**
Plan: `docs/plans/pr-why-risk-brief.md` · Spec: `server/specs/brief/01-pr-why-risk-brief.md` (`approved`)
Ceiling: **17** — the plan declared 13; raised to 16 at the Stage 1→2 boundary and to 17 for the post-verification fix round (see Decisions)

## Stages

| # | Stage | Status | Artefact / result |
|---|---|---|---|
| 0 | Intake & baseline | **done** | Tree committed clean (`4033e72`, `b5cd777`); pnpm blocker cleared; baseline green on both packages |
| 1 | Implementation (T0–T8) | **done** | all 9 tracks landed, `3c02235`…`53f5a75` |
| 2 | Review ×3 | **done** | R2 boundary: no crossings · R3 correctness: 3 major, 8 minor · R4 security: 0 blocker, 4 minor |
| 3 | Fix loop (3 rounds) | **done** | Round 1 `b73e812` (F1–F5) · Round 2 `9307805` (F6–F7) + the D-16 spec revision · Round 3 `fac7796` (F8–F9, post-verification). Nothing contested in any round |
| 4 | Verification | **done** | 18/20 steps · 28/35 ACs at the time. AC-7a and AC-28 were then closed by round 3; the e2e rows are settled by CI |
| 5 | Land | **done** | Committed per track and per round; `engineering-insights` was owned by T8 and deliberately not re-run |

### History rewrite before the push

GitHub push protection rejected the branch: the seeded Stripe fixture strings
(a Stripe-shaped secret key and publishable key) match its Stripe-key pattern. **This is exactly what
R4 predicted** — it recorded them as verifiably fabricated (wrong length for either real
Stripe format) but "realistic enough to trip GitHub push protection or a partner secret
scanner, which costs someone a revocation ticket for a string that was never a key."

Allow-listing them through the unblock URL was rejected in favour of the fix R4 named: the
values are now `sk_live_EXAMPLE_NOT_A_REAL_KEY_0000` and friends, applied across the whole
branch with `git filter-branch` so the pattern never enters the history at all. The seeded
patch keeps its shape, so `src/config.ts:12` is still the secret line that flow `09` and the
seeded finding both point at, and `09` asserts the identifier `stripeSecretKey`, not the
value. Server suite re-run after the rewrite: 408 passed.

A second location surfaced on the next push attempt and needed the same treatment:
`server/test/brief-provenance.test.ts:24` planted a Stripe-prefixed literal as one
of the three secrets it proves the provenance record cannot leak. The `sk_live_` prefix was
decorative — the string's job is to be unique, not to look like Stripe — so it became
`PLANTED-SECRET-PR-BODY-NEVER-LOGGED` and the test's assertions are unchanged.

**The lesson is the sweep, not the string.** The first pass fixed only what the reviewer had
named, and the second block cost another round trip. A branch-wide grep for every
secret-shaped literal (the Stripe, AWS and GitHub token prefixes) found
both in one pass and should have run first. `server/test/prompt-log.test.ts:11` carries a
third such literal and was left alone: it is already in pushed history, so scanning does not
re-flag it, and rewriting it would touch commits this branch does not own.

Commits from T2 onward took new SHAs; the table above and below carries the new ones.
Pre-rewrite state is kept at `backup/pre-secret-rewrite` locally.

**Agent count: 17 / 17 — at the ceiling.** One `implementer` per track T0–T7, `doc-writer` for T8, three reviewers at Stage 2, two fix rounds, one `spec-creator` for the D-16 revision, one `plan-verifier`, and one more `implementer` for round 3. (A 17th launch died on an API error before writing anything and is not counted — it did no work.)

### Tracks

| Track | Scope | Agent | Status | Commit |
|---|---|---|---|---|
| T0 | Contract, `pr_brief` widening, migration `0013_legal_mimic.sql` | 1 | **done** | `3c02235` |
| T1 | Reference resolver `{resolved, skipped}` + `dropWholeItems`, `container.blast` | 2 | **done** | `99cc43f` |
| T2 | `grounding` / `fingerprint` / `assemble` / `provenance` | 3 | **done** | `18c8322` |
| T3 | Repository, service, routes, `modules/index.ts`, `brief.it.test.ts` | 4 | **done** | `896d2f1` |
| T4 | Client hook + `messages/en/brief.json` | 5 | **done** | `8065d5d` |
| T5 | `WhyRiskCard` + Overview mount + the `page.tsx` wiring line | 6 | **done** | `c0b21f9` |
| T6 | Diff-viewer `focus` prop chain + `openFileFromBrief` | 7 | **done** | `8c8677b` |
| T7 | Seed row + `e2e/specs/09-pr-brief.flow.json` | 8 | **done** | `80a2b8b` |
| T8 | `doc-writer` → `INSIGHTS.md` | 9 | **done** | `53f5a75` |

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

### CLOSED by fix round 3 (`fac7796`)

Items 1 and 2 below were the verification's two open criteria. Both are now closed;
the text is kept because the *reason* each was missed is the durable part.

**AC-7a** — `drop_order_exhausted` is recorded on the assembler's `break` and carried
into the stored provenance record. The fixture is a real 900-hunk patch measured with
the real tokenizer, not a stubbed counter: ~12 `cl100k_base` tokens per hunk after
REQ-3 strips the bodies, so ~670 hunks in one file exhausts the budget. Two negative
tests keep the flag falsifiable.

**AC-28** — seeded PR #613 carries `pr_files` and no `pr_brief` row, and flow `09`
asserts the empty state and its generate control without pressing it. Proven by a DB
query after the run: zero `pr_brief` rows for #613.

### 1. AC-7a is not built — the one place work is done and its criterion still fails

The D-16 spec revision made REQ-4a **require** that an assembly record "the fact that the drop
order was exhausted". Nothing records it. `assemble.ts:376-377` breaks out of the drive-down loop
and sets no flag; `provenance.ts:70-84` has no such field; no test names AC-7a or REQ-4a.

This is a gap the pipeline created rather than inherited: fix round 2's brief explicitly put the
budget floor out of scope because the user had chosen to revise the spec instead — and the
revision then introduced a *new* obligation that no round was scoped to satisfy. The spec landed;
the code it now demands did not.

The nearest test, `brief-assemble.test.ts:294-326`, forces the floor with `countTokens: () =>
1_000_000` and asserts the full drop list and an over-budget estimate. It cannot assert the
exhaustion record (there is none) and, being a pure-function test, cannot assert that exactly one
structured call is still issued.

### 2. AC-28 has no e2e coverage, and the plan is why

S19 required an empty-state assertion for "a PR with no brief"; S18 gave the only seeded PR a
brief and authorised no second one. **The two steps contradict each other, and it was
discoverable at plan time.** The card's empty state is covered at unit level
(`WhyRiskCard.test.tsx:384`) but not end to end. Settled by a second seeded PR plus a flow step,
or by re-grading AC-28's `Verified by` to unit.

### 3. Five rows are `cannot tell`, all for one environmental reason

`./scripts/e2e.sh` gives 5/8 on this machine; flows `04`, `05` and `09` fail on the same
`find text … click`. The verifier reproduced it and read the mechanism straight out of the API
log: a real PAT makes the PR-list load do a doomed 404 round trip to GitHub, and `find` does not
poll the way `wait` does. It tried to isolate the variable with a scratch `HOME` — `secretsPath`
is hardcoded at `platform/config.ts:100` with no env override — and got 0/8, so that settles
nothing. **Settled by CI** (`.github/workflows/e2e-web.yml` brings up a stack with no PAT).

Affected: AC-27 (e2e half), AC-29 (navigation half), AC-34, S18's behavioural Done-when, S19.

### 4. Plan defects worth carrying into `/retro`

- The plan is **stale against its own binding spec**: 34 AC rows where the spec now has 35, and
  the pre-revision REQ-4 wording. Verification was done against the spec.
- **S11's Done-when grep gate is unsatisfiable by well-commented code** — `grep getOrCompute|
  NODE_ENV` cannot return nothing in a module that documents why it avoids them. It needs a
  code-only qualifier to be checkable as written.
- **S18's Done-when is behavioural with no runnable assertion**, so S18 cannot be verified
  independently of S19.
- The verification table names flows `01`–`09`; `08` does not exist and the plan says so itself.

### 5. Smaller

- **AC-5's NUL-byte half has no test.** The guard is present and unmodified
  (`references.ts:82`); the existing suite covers traversal, absolute, Windows-absolute and
  out-of-allow-list, but nothing plants a `\0` path.
- **S4 landed a third additive change** where the plan said "two and nothing else" — a
  `unavailableReason(ref, deps)` helper. Additive and in service of BQ-3, but outside the letter.
- `grounding.ts` is pure directly but not transitively: it imports `headLineRanges` from
  `assemble.ts`, which imports `platform/prompt.js`.
