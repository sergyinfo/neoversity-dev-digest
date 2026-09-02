# Cross-model review: Eval Pipeline (L06)

**Plan:** `docs/plans/eval-pipeline.md` · **Spec:** `specs/eval-pipeline.md` · **Date:** 2026-09-02
**Reviewed by:** `gemini-3.5-flash` (Google) · **Route:** direct Gemini API, `GEMINI_API_KEY` from the environment
**Verdict:** Sound enough to execute. Four confirmed findings, none of them design-level; two rejected with evidence; no ordering errors and no orphan steps.

## What the reviewer was given

The spec verbatim, the plan, and the repo constraints a stranger cannot infer. **The plan's `## Settled premises` block was withheld** — it names every blocking question and recommendation we settled and instructs the reader not to re-open them, which is precisely the anchoring this stage exists to avoid. The reviewer therefore judged the batch-in-jsonb decision, the precision definition and the no-LLM scoring rule cold, with no idea which alternatives we had already rejected.

`gemini-3.1-pro-preview` and `gemini-pro-latest` were both quota-exhausted (HTTP 429); the flash model answered. The first attempt was truncated at `MAX_TOKENS` and was re-run with a larger budget — the note reflects the complete second answer.

## Findings

| # | Finding | Kind | Our verdict | Evidence |
|---|---|---|---|---|
| 1 | S4 never populates `input_files` / `input_meta`, though the spec says a run uses "only the case's stored `input_diff`, `input_files` and `input_meta`" — so a run may execute with empty inputs | uncovered requirement | **rejected** | `reviewer-core/src/review/run.ts:44-97` — `ReviewInput` has **no file-contents field at all**: `systemPrompt`, `model`, `diff: UnifiedDiff`, `llm`, and optional context strings. The engine cannot consume `input_files`, so a null column cannot starve it. The spec sentence is a *restriction* ("nothing beyond these"), not an instruction to populate all three. `input_meta` **is** written — S3 stores the idempotency key there. |
| 2 | The envelope deviates from the spec's own Contracts section, which declares `agent: { system_prompt, model, skills: string[] }`; the plan makes `skills` an array of objects | weak done-when / spec drift | **confirmed** | `specs/eval-pipeline.md` §Contracts says `skills: string[]`; plan S1 says `skills: { id, name, version, content_hash }[]`. Nothing type-breaks — the given `EvalRunRecord.actual_output` is `z.unknown()` — but an approved spec now disagrees with the plan built from it. The reviewer also caught a factual error in the spec: it assumed skill *slugs* exist, and `server/src/db/schema/skills.ts` has no `slug` column. |
| 3 | S8's "Done when" passes on unit tests alone; a prop-threading bug in `FindingsPanel` or `ReviewRunAccordion` would leave case creation broken in the running app | weak done-when | **confirmed** | S8's Done-when reads "all three cases pass and the button is disabled". Nothing exercises the mutation end to end: S15's e2e flow deliberately never clicks the button (flows never mutate), and S6 tests the route, not the wiring. The gap is real and is the direct cost of REC-7's read-only constraint. |
| 4 | S9's "Done when" asserts only that `TABS` and `VALID_TABS` list `evals`; the tab could still crash on render | weak done-when | **confirmed (minor)** | S9's Test line *does* list the `EvalsTab.test.tsx` assertions, but its Done-when names only the two-place wiring. A Done-when narrower than its own Test line is a Done-when that can pass while the step has failed. |
| 5 | Synchronous runs risk client-side and proxy timeouts — 50 sequential model calls can exceed the 60s that browsers and reverse proxies commonly cut connections at, even though Fastify itself sets no `requestTimeout` | unnamed risk | **confirmed** | The plan names only the Fastify side ("Fastify sets no `requestTimeout` … so it will complete"). It says nothing about the browser or any proxy in front of it. With a 50-case cap this is reachable. |
| 6 | The engine may produce zero findings forever because `input_files` is empty, pinning recall at 0 | unnamed risk | **rejected** | Same evidence as #1 — the engine has no file-contents input, so this failure mode does not exist. |
| — | Requirements covered by no step | uncovered requirement | **none found** | Reviewer: "no findings" |
| — | Steps satisfying nothing in the spec | orphan step | **none found** | Reviewer: "no findings" |
| — | Ordering / dependency errors | ordering | **none found** | Reviewer explicitly endorsed the T0–T5 dependency shape and the T2 split |

## Applied to the plan

**None — the plan is unchanged.** All four confirmed findings are carried into execution as explicit obligations on the tracks that own them, rather than as plan edits:

- **#2** → T0's brief already specifies the object-shaped snapshot and already warns that `skills` has no `slug` column. The drift is between the *spec* and the plan, not inside the plan; the spec's Contracts sketch is superseded by the plan and the PR description must say so, alongside the already-flagged `GET /agents/:id/eval-runs` addition.
- **#3** → T3 must widen S8's Done-when to assert the mutation is invoked through `ReviewRunAccordion`, not merely that the button renders enabled.
- **#4** → T4 must treat S9's Test line as its Done-when: the `EvalsTab` suite must be green, not only the `AgentEditor` tab-switch assertion.
- **#5** → T1 must surface run failures in the UI as a recoverable state. The rows already written survive a timeout (S4 guarantees that), so a timed-out run is not lost data — but the client must not present it as success.

## Not applied

Nothing confirmed was discarded. Findings #1 and #6 were rejected on the same evidence and are recorded above rather than silently dropped, because a reader of this note should be able to see that the "empty `input_files`" concern was examined and refuted at a specific line, not overlooked.

**One caveat about this review's weight.** The reviewer opened by calling the plan "exceptionally thorough" and returned no findings in three of five categories. Both pro-tier models were unavailable, so this is a flash-tier read. It caught one genuine spec-versus-plan drift (#2) that our own process had not written down anywhere — which is exactly what the stage is for — but a note with no design-level objection should be read as *not refuted*, not as *endorsed*.
