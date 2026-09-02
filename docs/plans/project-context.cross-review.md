# Cross-model review: Project Context

**Plan:** `docs/plans/project-context.md` · **Spec:** `server/specs/project-context/01-project-context.md` · **Date:** 2026-08-29
**Reviewed by:** `gemini-3.6-flash` (Google) · **Route:** direct API call, `GEMINI_API_KEY` from the environment, confirmed by the user in this run
**Verdict:** Sound enough to execute. No uncovered requirement, no orphan step, no ordering error. Two real defects in step "Done when" text and one unnamed risk — all three cheap, all three worth fixing before T1 and T2 start.

The reviewer received the spec, the plan verbatim, and the repository constraints a stranger cannot infer. It received **nothing** about how the plan was reached — no blocking questions, no answers, no accepted or rejected recommendations.

**Cost:** 35 018 input tokens, 796 output, 13 577 thinking. The first attempt returned truncated at `finishReason: MAX_TOKENS` because thinking consumed the 8 192-token budget; re-run at 40 000.

## Findings

| # | Finding | Kind | Our verdict | Evidence |
|---|---|---|---|---|
| 1 | **S3's unique index does not prevent duplicates.** `(agent_id, skill_id, repo_id, path)` with `agent_id`/`skill_id` mutually exclusive nullable: Postgres treats `NULL` as distinct in a standard unique index, so two identical agent attachments (both with `skill_id = NULL`) are both accepted | weak done-when | **confirmed** | Property of SQL, not of this repo — and it is the direct price of R1's two-nullable-FK design, which the plan accepted. This deployment is **Postgres 16** (dev container reports `16.15`; `server/test/helpers/pg.ts:36` pins `pgvector/pgvector:pg16`), so `UNIQUE NULLS NOT DISTINCT` is available; two partial unique indexes are the portable alternative. S3's "Done when" as written would pass `db:generate` and still admit duplicates |
| 2 | **`.devdigest/specs` cannot match under segment matching**, so AC-4 fails | weak done-when | **confirmed in mechanism, rejected in consequence** | The mechanism is right: S4 puts a two-segment string into a list that S5 compares **per segment**, and `'.devdigest/specs'` can never equal one segment. The consequence is wrong: `REFERENCE_DOC_DIRS` contains `specs` (`server/src/modules/intent/constants.ts:6`), so `.devdigest/specs/prd.md` matches on its own `specs` segment and **AC-4 passes anyway**. I also checked the walk it copies — `.devdigest` is not in `EXCLUDED_DIRS` (`repo-intel/constants.ts:17-26`) and `walk.ts:88-92` skips only excluded names, not dot-directories, so the directory is reached. **The real defect is that the list entry is inert:** it does nothing, it is redundant with `specs`, and a later reader will trust it to carry the `.devdigest/specs/` rule that §REQ-2 states as a separate prefix predicate |
| 3 | **A clone path that is set but missing on disk is unhandled.** The plan covers `clone_path: null` (AC-2) and unreadable sub-directories, but not `ENOENT` at the clone root | unnamed risk | **confirmed** | The copied walk tolerates it — `walk.ts:79-86` catches `readdir` failure per directory including the first — but S5's containment gate is **new code outside that pattern**: a `realpath` of the clone root throws `ENOENT` when the directory is gone. AC-2 requires "an empty list with an explicit *not cloned* reason, not a 500", and a repo whose clone was deleted is indistinguishable to the user from one never cloned |

## Applied to the plan

All three, via the planning agent — amended there rather than by hand, so the plan stays the artefact one author produced.

**F1 — S3's uniqueness form replaced.** The four-column unique index is gone; S3 now specifies **two partial unique indexes**, `ctx_att_agent_repo_path_uq` and `ctx_att_skill_repo_path_uq`, each `WHERE <fk> IS NOT NULL`. `UNIQUE NULLS NOT DISTINCT` was rejected **on meaning, not capability** — it makes uniqueness depend on the `num_nonnulls` CHECK continuing to hold, so relaxing that CHECK would silently change the uniqueness rule. Both forms were verified generatable against the **installed** packages, not the docs: `pg-core/indexes.d.ts:67` exposes `where(condition: SQL)`, and drizzle-kit 0.30.6's `bin.cjs` emits both `${idx.where}` and `NULLS NOT DISTINCT`. Worth recording: `nullsNotDistinct()` lives on the **constraint** builder (`unique-constraint.d.ts:10`), not on `uniqueIndex()` — reaching for it there is a typecheck error and an easy mistake from memory.

**F1 — S3 gained its own named test.** Its `Test` line changed from "covered by S8's integration tests" to a new `server/test/project-context-schema.it.test.ts`. **This is the one place the amendments changed step content rather than adding a clause:** a constraint needs a test that tries to violate it, and deferring to S8 was not that. S6 gained a clause so a duplicate attach returns a clean domain error rather than a raw unique-violation.

**F2 — S4 split one list into two predicates.** `CONTEXT_DOC_DIR_SEGMENTS` (per **segment**) and `CONTEXT_DOC_PATH_PREFIXES` (leading **prefix**). `.devdigest/specs` is explicitly barred from the segment list. "State both predicates" was chosen over "drop as redundant" because `REFERENCE_DOC_DIRS` is owned by the **`intent` module** — if it ever loses `specs`, `.devdigest/specs/` discovery would vanish silently. S5 implements both and gained the test that makes the entry non-inert: the prefix case is asserted **with the segment list stubbed to exclude `specs`**, so it fails if the prefix branch is removed.

**F3 — a third clone state, end to end.** S2's envelope gained `reason: 'not_cloned' | 'clone_missing' | null`; S5 resolves the clone root once per request through a helper that classifies its own failure (`ENOENT` ⇒ `clone_missing`, other errors ⇒ existing handling, **never a 500**); S8 requires all three outcomes distinguishable and none a 5xx; S11 carries the reason; S12 requires **two distinct copy strings**; S15 renders both as non-error empty states; and S10 gained a clause so a deleted clone skips every document and the run completes, rather than the containment call throwing opaquely.

**Unchanged:** BQ-1…BQ-5, every recommendation decision, the track decomposition, the model assignments, the barriers, and the **agent count — still 11**. No step moved tracks and no track was added.

## Not applied

None. All three findings were cheap enough that deferring any of them would have cost more to re-discover during T1 or T2 than to fix now.

## What the reviewer got right that we would not have

Finding 1 is the one worth naming. It is a consequence of a design decision this plan **deliberately accepted** — the two-nullable-FK shape exists precisely so cascade-delete works, and the reviewer never saw that reasoning. It caught the cost of that choice from the SQL alone. That is what an independent read is for, and it is the finding least likely to have surfaced from inside.
