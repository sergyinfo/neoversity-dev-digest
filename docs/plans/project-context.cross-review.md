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

1. **S3** — the uniqueness requirement is restated so it holds with a NULL in either FK column, and the "Done when" now demands a test that inserts the same attachment twice and expects the second to fail.
2. **S4/S5** — the `.devdigest/specs` entry is either dropped as redundant or the two predicates are stated separately, and S5's "Done when" says which. The point is that no list entry silently does nothing.
3. **S5/S8** — a clone directory that is configured but absent returns AC-2's empty-list-with-reason, not a 500, and the reason distinguishes it from never-cloned.

## Not applied

None. All three findings were cheap enough that deferring any of them would have cost more to re-discover during T1 or T2 than to fix now.

## What the reviewer got right that we would not have

Finding 1 is the one worth naming. It is a consequence of a design decision this plan **deliberately accepted** — the two-nullable-FK shape exists precisely so cascade-delete works, and the reviewer never saw that reasoning. It caught the cost of that choice from the SQL alone. That is what an independent read is for, and it is the finding least likely to have surfaced from inside.
