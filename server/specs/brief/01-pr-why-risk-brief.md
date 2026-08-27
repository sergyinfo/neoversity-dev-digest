---
module: server/brief
spec: 01-pr-why-risk-brief
status: approved       # draft → approved (set by a human) → superseded (set by /spec)
updated: 2026-08-27
supersedes:
lesson: L05
issue:
pr:
e2e-flow: e2e/specs/09-pr-brief.flow.json (to add — 08 is claimed by server/specs/project-context/01 but is not yet on disk)
design: screenshots of the PR Overview and Files-changed tabs supplied 2026-08-27; the committed bundles `client/specs/DevDigest Design (standalone).html` and `… (3).html` could NOT be opened — `file://` is blocked in the browser tool
---

# Spec: PR Why + Risk Brief

## 1. Problem & outcome

A reviewer opening a pull request today gets its derived intent (`IntentCard`) and its
dependency impact (`BlastCard`) as two separate panels, and a diff grouped core/wiring/
boilerplate on another tab. Nothing tells them, in one place, what this change does, why, how
risky it is, and which few lines to read first — so the reading order is rediscovered by hand on
every PR.

Solved means: a reviewer can generate, for a pull request, a brief stating what it changes and
why, one overall risk level, concrete risks each pointing at real files, and a short ordered
"read these first" list whose entries navigate to that exact file and line on the Files changed
tab. Re-opening the same PR in the same state costs nothing — the brief is served from stored
state with no model call — and a separate control regenerates it on demand.

## 2. Users & triggers

The DevDigest studio user reviewing a pull request in a single local workspace.

- **Read trigger:** opening a pull request's Overview tab. This never calls a model (D-14).
- **Assembly trigger:** the user activating the brief's generate control.
- **Regeneration trigger:** the user activating the brief's regenerate control.
- **Navigation trigger:** the user activating a review-focus entry.

## 3. Scope

**In scope**

- One brief per pull request: what, why, one risk level, risks, an ordered review focus.
- One structured model call per assembly, from five named inputs, with an agreed input budget
  and a fixed unit of measurement.
- A grounding filter that discards every model-returned reference not present in the inputs.
- A state fingerprint that decides cache hit vs. re-assembly, and a regenerate control.
- The **Why & Risk** card on the Overview tab, and click-through from a review-focus entry into
  the Files changed tab at that file and line.

**Out of scope — already ships, do not rebuild**

- **Intent derivation, caching and its regenerate control.** `pr_intent`
  (`server/src/db/schema/reviews.ts:48-72`), `GET`/`POST /pulls/:id/intent`
  (`modules/intent/routes.ts:21-41`, POST rate-limited 5/min at `:33-34`), lazy derivation on
  `GET /pulls/:id` (`modules/pulls/routes.ts:349-382`), and `IntentCard` with its
  `useRecomputeIntent` button (`_components/IntentCard/IntentCard.tsx:68-131`). This spec
  **reads** intent and never derives it (D-12).
- **The reference parser and resolver, and its whole security posture.** `parseReferences` /
  `resolveReferences` (`modules/intent/references.ts`), the repo-file allow-list of documentation
  directories (`REFERENCE_DOC_DIRS`, `modules/intent/constants.ts:6`), `isSafeRepoPath`
  rejecting `..`, a leading `/`, Windows-absolute paths and NUL bytes and **re-checked in
  `fetchOne()` as the last gate before a filesystem read** (`intent/references.ts:58-66`), the
  per-kind caps of 5 repo files / 5 GitHub references / 3 URLs, the 12 KB total budget, the
  resolution order `repo-file → github → url` so the least trustworthy source is dropped first,
  and `adapters/http/web-fetch.ts` behind `INTENT_EXTERNAL_FETCH_ENABLED` (default **false**),
  enforced in the `container.webFetch` getter so no call site can forget it
  (`server/docs/intent-layer.md:170-225`; `platform/config.ts:29-34`). D-13 **reuses** all of it
  and adds none of it.
- **The blast map, its degradation semantics and its card.** `GET /pulls/:id/blast`
  (`modules/blast/routes.ts:22-45`), `BlastResponse` with `head_sha`/`indexed_sha`/`state`/
  `counts`/`map`/`prior_prs` (`modules/blast/contract.ts:66-83`), the state-first degradation
  gate (`modules/blast/service.ts:54-67, 86-96`), and `BlastCard` (`_components/BlastCard/`).
- **The optional blast summary paragraph.** `POST /pulls/:id/blast/summary`
  (`modules/blast/routes.ts:50-61`) with its own 150-**output**-token cap (`modules/blast/
  summary.ts:34`). The brief does **not** call it (D-4).
- **The reviewer-ordered Files changed tab.** `GET /pulls/:id/smart-diff`
  (`modules/smart-diff/routes.ts:20-23`), `SmartDiffViewer` with Core/Wiring/Boilerplate
  ordering (`_components/SmartDiffViewer/constants.ts:9-34`), per-file "What this does"
  (`SmartDiffFile.pseudocode_summary`, `contracts/brief.ts:113`) and finding markers.
- **Linked-issue resolution.** `PrDetail.linked_issue` (`contracts/platform.ts:218`), resolved
  by regex over the PR body (`adapters/github/octokit.ts:126-131`).
- **Diff statistics.** `pull_requests.additions/deletions/files_count` (`db/schema/pulls.ts:
  22-24`) and per-file counts in `pr_files` (`:36-45`).
- **The `risk_brief` feature-model slot** — id, label "Risk Brief", description "Assesses merge
  risks for a pull request", default `openai/gpt-4.1` (`contracts/platform.ts:20, 63-69`),
  resolved by `resolveFeatureModel` (`platform/feature-models.ts:58-64`), already borrowed by
  blast (`modules/blast/summary.ts:101`). No `FEATURE_MODELS` edit is needed, and therefore no
  edit to the third hand-mirrored copy at `client/src/lib/feature-models.ts` (D-11).
- **The `Risk` / `Risks` / `RiskSeverity` contracts** — `{kind, title, explanation, severity,
  file_refs}` (`contracts/brief.ts:74-89`), byte-identical in both vendored copies. `risks[]`
  reuses `Risk` as-is (D-10).
- **The `pr_brief` table** — `{pr_id PK → pull_requests ON DELETE CASCADE, json jsonb}`
  (`db/schema/reviews.ts:74-79`, migration `0000_init.sql:211`), shipped in part-0 with **zero
  writers**. It is the storage for this feature (D-6).
- **Untrusted-input fencing.** `wrapUntrusted` neutralises `</untrusted>` escapes and
  `INJECTION_GUARD` names untrusted blocks as data (`reviewer-core/src/prompt.ts:16-34`); blast
  already applies the pattern to a third-party map (`modules/blast/summary.ts:49-50, 112`).
- **The one-structured-call machinery.** `LLMProvider.completeStructured` returning
  `{data, model, tokensIn, tokensOut, costUsd, raw, attempts}` (`vendor/shared/adapters.ts:
  55-88`), with `maxTokens`, `timeoutMs` and `maxRetries` on the request.
- **The token counter.** `TiktokenTokenizer` over `cl100k_base` with an `approxTokens`
  fallback (`adapters/tokenizer/index.ts:21-40`), on the container (`platform/container.ts`).
- **UI primitives.** `Badge`/`SeverityBadge` (`vendor/ui/primitives/Badge.tsx:5-88`),
  `MonoLink` with an in-app `onClick` variant (`primitives/MonoLink.tsx:3-53`), `Button` with
  `loading` (`primitives/Button.tsx:10-87`), the single API entry point (`lib/api.ts:21-74`).
- **Some brief copy.** `client/messages/en/brief.json` ships with zero readers: `block.risks`
  "Risks", `noRisks` "No notable risks flagged.", `unavailable` "Brief not available yet."
  (`:5, 8, 11`). Reused per F-5. `unavailableHint` is **rewritten** (F-6); `why.*` and
  `block.intent`/`block.blast`/`block.history` are **not** reused (F-5).
- **Error taxonomy and rate limiting.** `NotFoundError` 404 / `ValidationError` 422 /
  `ExternalServiceError` 502 (`platform/errors.ts:19-35`); global 120 req/min
  (`app.ts:95-97`); per-route override precedent 5/min (`intent/routes.ts:33`,
  `blast/routes.ts:54`).

**Out of scope — deliberately not built**

- **A project-context attachment surface for the brief.** D-13 gives the brief only the documents
  the **PR body itself references**. It gives **no attachment UI, no per-agent or per-skill
  selection, and no document that is not named in the PR body** — a repository can hold a
  perfectly relevant spec that this brief never sees because nobody linked it. That is the
  accepted limit of `01-`. When `server/specs/project-context/01-project-context.md` lands,
  attached documents become a **second possible source** for this input; adopting them is a
  future numbered spec's decision, made explicitly, and not a silent upgrade of this one.
- **The Why Timeline** — the history of briefs across a PR's commits (D-9). A separate numbered
  spec in this module.
- Any change to the review verdict, score, findings or their persistence. The brief is
  **display-only**; nothing on the scoring or persistence path reads it (D-3).
- Any second model call: no per-risk elaboration, no re-ask, no fan-out (D-4).
- Any automatic assembly — on PR open, on import, on poll, or at the end of a review run (D-14).
- **Read-time detection of an edited linked issue or an edited referenced document.** Their
  digests are in the stored fingerprint but are not recomputed on the read path, because doing so
  would mean a live GitHub call and a set of clone reads on every PR open — the work D-14 forbids
  and §7's 300 ms read budget cannot hold. They are compared at the next assembly instead (D-1a).
- Posting the brief to GitHub, or including it in a review comment.
- Editing a brief by hand, or accepting/dismissing individual risks.
- Any change to `reviewer-core`, which this feature never calls.
- Renaming the design's "PR Brief" verdict block, which is unbuilt and keeps that name (D-15).
- Rewriting `client/messages/en/context.json:13` ("Every agent and **the PR brief** read them as
  grounding context") — that line is already owned by `project-context/01` §11 (F-8).

## 4. Requirements

Requirements are written in EARS; the `Pattern` column names which one. One pattern per row.

| ID | Pattern | Requirement | Rationale | Status today |
|---|---|---|---|---|
| REQ-1 | Ubiquitous | THE SYSTEM SHALL expose, for a pull request, a brief carrying a `what` statement, a `why` statement, one `risk_level` drawn from `high`/`medium`/`low`, a list of risks, and an ordered review-focus list. | Requirements 2 and 5 — the agreed shape. | absent — the shipped `PrBrief` composes `{intent, blast, risks, history}` (`contracts/brief.ts:143-149`); `grep -rn "risk_level\|review_focus"` over both vendor trees returns nothing |
| REQ-2 | Event-driven | WHEN the user explicitly requests a brief assembly, THE SYSTEM SHALL build the model input from exactly five sources — the stored intent, the blast map, the PR's diff statistics and changed-file list, the linked issue, and the specification and plan documents referenced by the PR body and resolved at assembly time — and SHALL issue exactly one structured model call. | Requirements 1 and 2, with D-13's source and D-14's trigger. "Exactly one" is the bar blast already holds itself to (`blast/summary.ts:9-13`). | absent — no `brief` module is registered (`modules/index.ts:29-43`), though `:26` names `brief` as a planned lesson module |
| REQ-3 | Ubiquitous | THE SYSTEM SHALL exclude every diff hunk **body** from the assembled model input; the input may carry changed-file paths, per-file addition and deletion counts, and hunk header ranges, and SHALL carry no added, removed or context source line. | Requirement 1's hard constraint. Enforceable and checkable, not a note — AC-6. | absent for the brief; the identical guarantee already holds for intent (`intent/classifier.ts:135-146`, documented at `server/docs/intent-layer.md:109-114`) |
| REQ-4 | Ubiquitous | THE SYSTEM SHALL keep the assembled model input at or below **8 000 estimated tokens**, where an estimated token is one `cl100k_base` token counted by the server's existing tokenizer over the concatenation of the system message and the user message, with `ceil(chars / 4)` as the fallback when the encoder fails to load. | The assignment's budget, with its unit fixed. Consistent with the approved sibling spec (D-2). | absent |
| REQ-5 | Event-driven | WHEN the assembled input exceeds 8 000 estimated tokens, THE SYSTEM SHALL drop **whole** items from the end of the fixed priority order — resolved reference documents, then the linked issue, then blast-map symbols beyond the highest-ranked, then changed files beyond the first 60 — and SHALL complete the assembly rather than failing it. | D-8. Truncating a document mid-sentence can cut a "must not" and invert it; the house precedent is omit-don't-throw (`server/CLAUDE.md`). | absent |
| REQ-6 | Unwanted | IF a model-returned risk file reference or review-focus reference is not present in the grounding allow-list, THEN THE SYSTEM SHALL discard that reference and count it, and SHALL NOT repair, fuzzy-match, or substitute it. | Requirement 3, and the course criterion "risks reference files from the blast map". Repairing a wrong path silently asserts a different claim. | absent — intent performs **no** grounding of its model output at all (`in_scope`/`out_of_scope` are free-text nouns, `intent/classifier.ts:43-56`) |
| REQ-7 | Unwanted | IF the model reports a `risk_level` higher than the highest `severity` among the risks that survived REQ-6, THEN THE SYSTEM SHALL lower the stored `risk_level` to that highest surviving severity. | D-7. Mirrors intent's `confidence = min(model band, evidence tier)` — our code may only ever lower the model's claim (`intent/classifier.ts:120-132`). | absent |
| REQ-8 | Ubiquitous | THE SYSTEM SHALL store with every brief a **state fingerprint** derived from the PR head sha, the stored intent's derivation timestamp and model, the blast map's `indexed_sha` and `state`, the linked issue's number, state and content digest, the source identifier and content digest of every resolved reference document that entered the input, the resolved feature-model provider and model, and the brief assembler version. | The assignment's "cached for a specific PR state" made precise. Head sha alone is provably insufficient — see D-1's four counterexamples. All ten components are stored and all ten are compared at assembly; which subset the *read* path recomputes is REQ-14's concern (D-1a). | absent — `pr_brief` has only `{pr_id, json}` (`db/schema/reviews.ts:74-79`) and cannot express a fingerprint |
| REQ-9 | Ubiquitous | THE SYSTEM SHALL call a model only on an explicitly requested assembly: reading a brief, opening the pull request, and requesting an assembly whose fingerprint already matches a stored brief SHALL each complete with no model call. | D-14, and the course criterion "re-opening the same PR state reads the cache with no new LLM call" — satisfied structurally rather than by a test-environment guard. | absent |
| REQ-10 | Event-driven | WHEN the user activates the brief's regenerate control, THE SYSTEM SHALL assemble and call the model regardless of any matching stored fingerprint, and SHALL replace the stored brief on success. | Requirement 4 — "a separate button triggers regeneration". Mirrors `POST /pulls/:id/intent`, which always recomputes (`intent/service.ts:86-95`). | absent |
| REQ-11 | Unwanted | IF the stored intent is absent **and** the blast map state is `degraded`, THEN THE SYSTEM SHALL refuse to assemble a brief and SHALL return an explanation naming both missing inputs. | D-5. Mirrors `summariseBlast`'s refusal on a degraded map — "a paragraph about a map we could not build would read as analysis when it is nothing of the kind" (`blast/summary.ts:93-99`). | absent |
| REQ-12 | Ubiquitous | THE SYSTEM SHALL render on the pull request's Overview tab a card labelled **Why & Risk**, showing the risk level as a labelled severity indicator, the `what` and `why` statements, the risks with their severities and file references, and the review-focus list. | Requirement 5, with D-15's label. | absent — `OverviewTab.tsx:17-36` renders `IntentCard`, `BlastCard` and the PR description only |
| REQ-13 | Event-driven | WHEN the user activates a review-focus entry, THE SYSTEM SHALL open the pull request's Files changed tab with that entry's file expanded and, where the entry carries a line, that line scrolled into view. | Requirement 5 — "clickable". | absent — `lineDomId` (`components/diff-viewer/helpers.ts:18-20`) is rendered **only** on lines already in `findingLines` (`FileCard.tsx:162, 174-182`), and no query-param entry point drives it; the reverse direction ships (`page.tsx:99-130`) |
| REQ-14 | State-driven | WHILE a stored brief's **locally recomputable** fingerprint components — the PR head sha, the stored intent's derivation timestamp and model, the blast map's `indexed_sha` and `state`, the resolved feature-model provider and model, and the assembler version — differ from those same components recomputed at read time, THE SYSTEM SHALL render that brief marked as out of date and name which of those inputs moved. | A cached brief that silently describes an older head is worse than none — this is the failure mode REQ-8 exists to prevent, made visible. Scoped to the locally recomputable components because recomputing the other two would mean re-resolving the linked issue and every reference document on every PR open — the work D-14 forbids and §7's 300 ms read budget cannot hold. Those two are compared at the next assembly instead (D-1a). | absent |
| REQ-15 | Ubiquitous | THE SYSTEM SHALL record for each assembly, carrying **no input content**, which of the five sources contributed, which reference documents resolved and which were skipped and why, the estimated input token count, the model-reported input and output token counts, the cost, and the number of references discarded by REQ-6. | The assignment asks a reviewer to inspect provenance; a discard count is also the only early signal that the prompt or the model has gone wrong. | absent — the safety contract to copy is `modules/reviews/prompt-log.ts:14-21`, asserted against planted secrets by `server/test/prompt-log.test.ts` |

*Patterns used: Ubiquitous ×7, Event-driven ×4, Unwanted ×3, State-driven ×1. **Optional
(`WHERE …`) is unused, deliberately.** The one flag in this feature's neighbourhood,
`INTENT_EXTERNAL_FETCH_ENABLED`, is enforced inside the `container.webFetch` getter rather than
at any call site (`server/docs/intent-layer.md:346-350`), so a new consumer cannot opt out of it
and there is no behaviour here that could independently fail. It is recorded as inherited
behaviour in Out of scope, as a §6 row and as an acceptance criterion, not as a requirement this
feature owns.*

## 5. Acceptance criteria

| ID | Covers | Given / When / Then | Verified by |
|---|---|---|---|
| AC-1 | REQ-1 | Given a PR with a stored brief / When the brief is read / Then the response carries a non-empty `what`, a non-empty `why`, a `risk_level` in `high|medium|low`, a `risks` array, and a `review_focus` array. | integration |
| AC-2 | REQ-2 | Given a PR with no stored brief / When an assembly is requested with a recording model stub / Then exactly one structured completion is issued. | integration |
| AC-3 | REQ-2 | Given a PR whose intent is stale (its `head_sha` ≠ the PR head) / When a brief is assembled / Then the stored intent is read as-is and **no** intent derivation call is made. | integration |
| AC-4 | REQ-2 | Given a PR whose body links a repository plan under `docs/` and issue `#123` / When a brief is assembled / Then the input contains that document's text and that issue's body, and the recorded source list names all five sources. | integration |
| AC-5 | REQ-2 | Given a PR body referencing `../../../etc/passwd`, an absolute path, or a path containing a NUL byte / When a brief is assembled / Then that reference is rejected, no such file is opened, and the assembly completes without it. | unit |
| AC-6 | REQ-3 | Given a `pr_files.patch` containing the sentinel line `+const SENTINEL_DO_NOT_SEND = 1;` / When a brief is assembled / Then the captured model input does not contain that sentinel, and does contain that file's path and its `@@` hunk range. | unit |
| AC-7 | REQ-4 | Given an assembled input / When it is measured / Then the recorded estimate equals the tokenizer's `cl100k_base` count of the system message concatenated with the user message, and the recorded estimate is ≤ 8 000. | unit |
| AC-8 | REQ-4 | Given a tokenizer whose encoder fails to load / When an input is measured / Then the estimate equals `ceil(chars / 4)` and the assembly still completes. | unit |
| AC-9 | REQ-5 | Given inputs whose combined estimate exceeds 8 000 / When a brief is assembled / Then the estimate is at or under 8 000, no item appears partially, the dropped items are recorded, and the assembly succeeds. | integration |
| AC-10 | REQ-5 | Given a PR with 300 changed files / When a brief is assembled / Then at most 60 file entries appear in the input and the omission is recorded. | unit |
| AC-11 | REQ-5 | Given resolved reference documents totalling more than the 12 KB budget / When a brief is assembled / Then whole documents are dropped in the shipped resolution order and each drop is recorded by source, never by content. | unit |
| AC-12 | REQ-6 | Given a model returning a `review_focus` entry for `src/does-not-exist.ts` and one for a real changed file / When the brief is stored / Then only the real entry survives and the discard count is 1. | unit |
| AC-13 | REQ-6 | Given a model returning `src/api/user.ts` where the diff contains `src/api/users.ts` / When the brief is stored / Then the entry is discarded, not corrected to the near match. | unit |
| AC-14 | REQ-6 | Given a blast map naming caller file `src/server.ts` which is **not** in the diff, and a model risk referencing it / When the brief is stored / Then that reference survives, because the allow-list includes blast-map caller files. | unit |
| AC-15 | REQ-6 | Given every model-returned review-focus reference is discarded / When the card renders / Then the review-focus empty state appears and no changed file is substituted in. | unit + unit (client) |
| AC-16 | REQ-7 | Given a model returning `risk_level: "high"` with all surviving risks at `low` / When the brief is stored / Then the stored `risk_level` is `low`. | unit |
| AC-17 | REQ-7 | Given a model returning `risk_level: "low"` with a surviving `high` risk / When the brief is stored / Then the stored `risk_level` stays `low` — the rule only lowers. | unit |
| AC-18 | REQ-8, REQ-9 | Given a brief assembled for a PR / When an assembly is requested again with every input unchanged / Then the stored brief is returned and the model stub records zero further calls. | integration |
| AC-19 | REQ-8 | Given a stored brief / When the PR head moves and the brief is requested / Then the fingerprint differs and the brief reads as out of date. | integration |
| AC-20 | REQ-8 | Given a stored brief and an unchanged head / When, in turn, the intent is recomputed via `POST /pulls/:id/intent`, the repo is re-indexed to a new `indexed_sha`, the linked issue's body is edited, a referenced repository document is edited, and the `risk_brief` model is changed in Settings / Then the fingerprint differs in every one of the five cases. | integration |
| AC-21 | REQ-9 | Given a PR with a stored brief / When the Overview tab is opened and the brief is read / Then the model stub records zero calls, with **no `NODE_ENV` guard in the path**. | integration |
| AC-22 | REQ-9 | Given a PR with **no** stored brief / When the Overview tab is opened / Then an explicit no-brief outcome is returned, no model call is made, and no assembly is started. | integration |
| AC-23 | REQ-10 | Given a stored brief whose fingerprint matches / When the regenerate control is used / Then a model call is made and the stored brief is replaced. | integration |
| AC-24 | REQ-10 | Given the generate or regenerate control used six times inside one minute / When the sixth request arrives / Then it is rejected by the rate limit rather than served. | integration |
| AC-25 | REQ-11 | Given a PR with no stored intent and a `degraded` blast map / When an assembly is requested / Then a 422 is returned naming both missing inputs, and no model call is made. | integration |
| AC-26 | REQ-11 | Given a PR with no stored intent but an `ok` blast map / When an assembly is requested / Then the brief is produced, and the recorded source list omits the intent. | integration |
| AC-27 | REQ-12 | Given a PR with a stored brief / When the Overview tab loads / Then a card labelled "Why & Risk" renders, the risk level appears as a word (not colour alone), and the what, why, risks and review-focus sections all render. | unit (client) + e2e flow |
| AC-28 | REQ-12 | Given a PR with no stored brief / When the Overview tab loads / Then the "Brief not available yet." empty state renders with a generate control, and no model call is made. | e2e flow |
| AC-29 | REQ-13 | Given a brief whose first review-focus entry is `src/config.ts:12` and `src/config.ts` is in the diff / When that entry is activated / Then the Files changed tab opens, `src/config.ts` is expanded, and line 12 is scrolled into view. | e2e flow |
| AC-30 | REQ-13 | Given a review-focus entry with no line / When it is activated / Then the Files changed tab opens with that file expanded and no scroll target, without error. | unit (client) |
| AC-31 | REQ-14 | Given a stored brief and a moved head / When the Overview tab loads / Then the card renders with an out-of-date marker naming the head as the input that moved, its content still readable, and a regenerate control offered. | unit (client) + integration |
| AC-32 | REQ-15 | Given an assembly whose PR body, linked issue and referenced document each contain a planted secret / When the recorded provenance is read / Then none of the three secrets appears in it, and it names the sources, the resolved and skipped references by source, the estimate, the model token counts, the cost and the discard count. | unit |
| AC-33 | Inherited (`INTENT_EXTERNAL_FETCH_ENABLED`) | Given a PR body containing an `https://` reference and the flag at its default `false` / When a brief is assembled / Then no outbound fetch of that URL occurs, the reference is recorded as skipped, and the assembly completes. | unit |
| AC-34 | REQ-9, REQ-2 | Given the whole `09-pr-brief` e2e flow / When it runs / Then no LLM call is made at any point, because the flow never presses generate. | e2e flow |

## 6. States & corner cases

| Dimension | Trigger | Expected behaviour | Source |
|---|---|---|---|
| Cardinality — zero | PR has no stored brief | The shipped `brief.unavailable` "Brief not available yet." plus the **rewritten** hint and a generate control. Nothing is assembled until it is pressed | `brief.json:11-12`; D-14, F-6 |
| Cardinality — zero | Model returns no risks | `brief.noRisks` "No notable risks flagged." — never a fabricated risk | `brief.json:8` |
| Cardinality — zero | Every review-focus reference discarded by REQ-6 | Empty review-focus section; no substitution from the diff's own ordering | gap — decided here (AC-15) |
| Cardinality — zero | PR body references no plans, specs or issues | Assemble from the remaining four sources and record the reference source as contributing nothing. This is the **normal** case, not a degradation — the same posture intent takes (`docs/intent-layer.md:151-168`) | D-13 |
| Cardinality — zero | PR has zero changed files (polled but never opened, so `pr_files` is empty) | Refuse with 422: with no changed files there is no allow-list and nothing to brief | `server/INSIGHTS.md` 2026-08-02 |
| Cardinality — many | PR with 300+ changed files | First 60 file entries enter the input (REQ-5); a risk in file 61 can never be named, and the card says the file list was capped | intent's `MAX_FILES_LISTED = 60` (`intent/constants.ts:26`) |
| Cardinality — many | PR body links forty documents | The shipped per-kind caps (5 repo files / 5 GitHub / 3 URLs) apply unchanged, so forty links cannot crowd out the one plan committed in the repo | `docs/intent-layer.md:196-198` |
| Cardinality — many | Model returns 30 review-focus entries | Store and render at most 8, in the model's order; the design shows 4 | screenshot 5 — "REVIEW FOCUS — READ THESE FIRST 4" |
| Loading | Overview first load | Skeleton on the Why & Risk card only; `IntentCard` and `BlastCard` load independently and are never blocked by it | `IntentCard.tsx:38-49` skeleton precedent |
| Loading | Assembly in flight | Generate/regenerate shows `Button loading`; any previously stored brief stays on screen and is not blanked | `Button.tsx:24, 71-82`; `IntentCard.tsx:119-127` |
| Failure | Model call fails after its retries | 502; no stored brief replaced; any previous brief remains visible and marked out of date | `platform/errors.ts:31-35` |
| Failure | Model returns JSON failing the schema after `maxRetries` | Same as above; the raw response is never stored | `adapters/mocks.ts:92-95` |
| Failure | Brief read fails | Card shows an error state; `IntentCard` and `BlastCard` are unaffected | gap — decided here |
| Degraded dependency | One referenced document fails to resolve (deleted from the clone, GitHub 404, fetch error) | Skip that one reference, record it by source with a reason, continue with the rest and complete the assembly. One failure never affects the others | `docs/intent-layer.md:199-202` — every fetch is individually wrapped |
| Degraded dependency | An `https://` reference with `INTENT_EXTERNAL_FETCH_ENABLED` at its default `false` | The `container.webFetch` getter throws `ConfigError`; the caller treats it as "skip external references" and records the skip. No outbound request | `platform/config.ts:29-34`; `docs/intent-layer.md:346-350`; AC-33 |
| Degraded dependency | A repo-file reference whose path escapes the clone | Rejected by `isSafeRepoPath`, re-checked at the last gate before the read; never opened; recorded as skipped | `intent/references.ts:58-66`; AC-5 |
| Degraded dependency | Blast map `degraded` and intent present | Assemble with an empty map; the allow-list falls back to changed files; the card says impact is unknown, never "nothing is affected" | `blast/service.ts:54-67`; `BlastCard.tsx:87-96` |
| Degraded dependency | Blast map `partial` | Assemble; the brief carries the partial caveat, because a missing caller means a risk may be understated | `blast/service.ts:183-194` |
| Degraded dependency | GitHub unreachable, so no linked issue and no `#N` references | Assemble without them and record their absence; never fail | `pulls/routes.ts:305-306` |
| Degraded dependency | Intent absent (never derived, or derivation failed) | Assemble without it and record its absence; refuse only if the blast map is also degraded | REQ-11; `contracts/platform.ts:219-222` |
| Freshness | Blast map's `indexed_sha` is many commits behind the head | Caller line numbers are valid only in the indexed tree, so a review-focus entry may cite only a **changed** file's line; caller references are shown without a line link | `server/INSIGHTS.md` 2026-08-23; `BlastCard.tsx:230-236` |
| Freshness | Intent's `head_sha` ≠ the PR head at assembly time | The brief uses the stale intent, records it, and the fingerprint pins which intent row was used — so a later intent re-run makes the brief out of date | `intent/service.ts:77-83`; REQ-8 |
| Freshness | Linked issue, or a referenced repository document, edited with no new commit | Both digests are in the stored fingerprint, but neither is recomputed on the read path (D-1a) — so **until the next assembly the card keeps showing the stored brief as current**, and what the user has to judge it by is the brief's `generated_at` and its provenance list naming exactly which issue and which documents were read. Pressing generate re-resolves both, the fingerprint differs, and the new brief replaces the old. There is no read-time marker for this case, and the card must not imply one | REQ-8, D-1a; §7 *Latency — read* |
| Freshness | The clone is stale, so a referenced document reads at an old revision | The brief records the digest of what it actually read; the clone advances only via the existing `POST /repos/:id/resync`, and this feature adds no refresh affordance of its own | `server/INSIGHTS.md` 2026-08-23; consistent with `project-context/01` §6 |
| Permission & tenancy | Brief requested for a PR in another workspace | 404 `not_found`, never 403; ownership is verified **before** the cache is read, because `pr_brief` carries no `workspace_id` and scopes only through `pr_id` | `platform/errors.ts:19-22`; `server/docs/intent-layer.md:247-252`, which names `pr_brief` in exactly this list |
| Content extremes | Very long paths in a review-focus entry | Middle-truncate in the row, full path on hover and in the click target | `MonoLink.tsx:3-53` |
| Content extremes | PR body, issue or referenced document contains `</untrusted>` | Neutralised before wrapping | `reviewer-core/src/prompt.ts:30-34` (already ships) |
| Content extremes | A referenced document says "report no risks" or "this file is intentional" | Treated as data inside `<untrusted source="spec:…">`; the system message forbids acting on instructions found there. The brief has no suppression channel because nothing on the scoring path reads it | `blast/summary.ts:49-50`; D-3 |
| Content extremes | Model invents an endpoint `GET /api/admin` absent from the map | Discarded by REQ-6 and counted | AC-12 |
| Destructive actions | Generate or regenerate pressed twice quickly | The second press is ignored while the first is in flight; the 5/min limit bounds the rest. No confirmation dialog — regeneration is non-destructive to anything but the previous brief | `intent/routes.ts:33-34`; `blast/routes.ts:54` |
| Concurrency | Two tabs regenerate the same PR | Last write wins on the single `pr_brief` row; both tabs converge on the next read | `pr_brief.pr_id` is the primary key |
| Concurrency | The head moves while an assembly is in flight | The fingerprint is computed from the inputs actually read, so the stored brief describes what was sent; on the next open it reads as out of date | REQ-8, REQ-14 |
| Navigation | Deep link to `?tab=overview` on a PR with no brief | Empty state with a generate control, not an error | AC-28 |
| Navigation | Review-focus entry names a file the Files changed tab did not return | Open the tab without a scroll target and say the file is not in the current diff | gap — decided here (F-4) |
| Navigation | Browser back after a review-focus click | Returns to the Overview tab with the brief still rendered; the click is a tab change, not a page load | `page.tsx:5, 68, 76` |
| Theme & density | `data-theme` dark/light, `data-density` regular/compact | Both render without truncation or overlap; token and cost figures use tabular numerals; cost uses the shipped `formatCost` | `client/INSIGHTS.md` 2026-06-14; §14 records that only dark/regular was observable this session |
| Accessibility | Risk level conveyed | The level is a word plus an icon, never colour alone | `Badge.tsx:51` states the WCAG-AA reason; `client/INSIGHTS.md` 2026-08-17 — `ConfidenceNum` is percentage-only and wrong for a band |
| Accessibility | Review-focus keyboard path | Each entry is a real focusable control in reading order, activated by Enter/Space, announcing the file, the line and the reason | `MonoLink.tsx` renders a `<button>` in its `onClick` variant |
| Narrow viewport | Long review-focus reasons | The reason wraps below the reference rather than the reference truncating; the reference is what the user clicks | gap — decided here |

## 7. Non-functional requirements

| Class | Agreed value | Rationale |
|---|---|---|
| Limits — model input | **8 000 estimated tokens**, `cl100k_base`, measured over system + user messages (REQ-4) | The assignment's figure, with the unit fixed so two people measuring get the same number. Same counter and same figure as the approved sibling spec (D-2) |
| Limits — model output | **900 tokens** (`maxTokens` on the one structured request), i.e. the provider's own tokenizer | Enough for two short paragraphs, ~4 risks and ~6 focus entries with one-line reasons; blast's 150 sizes one paragraph (`blast/summary.ts:28-34`) and is far too small here. Under `completeStructured` an output cut short is invalid JSON and costs a retry, so this is sized with headroom |
| Limits — inputs | 60 changed-file entries; 12 blast symbols with 6 callers each; linked issue 2 000 chars; resolved references 5 repo files / 5 GitHub / 3 URLs and 12 KB in total | Reuses caps already agreed for the same data: `intent/constants.ts:26`, `blast/summary.ts:26-27`, `docs/intent-layer.md:104-105, 196-198` |
| Limits — output rendering | ≤ 8 review-focus entries and ≤ 6 risks rendered | The design shows 4 focus entries and 3 risk areas; beyond ~8 the list stops being "read these first" |
| Limits — rate | 5 assemblies per minute on the assembling route, inside the global 120/min. The read route takes no override | Exactly the override intent and the blast summary use for a paid route (`intent/routes.ts:33`, `blast/routes.ts:54`). The read route is free of model calls by REQ-9, so it needs no protection beyond the global limit |
| Latency — read | Under 300 ms, with no outbound call other than the reads needed to compute the fingerprint | A read that fetched a live issue over the network would be neither fast nor free |
| Latency — assembly | Model call timeout 60 s; reference resolution bounded by the shipped per-fetch timeouts; the whole request gives up at 90 s with a 502 | One structured call over ≤ 8 000 input tokens. `StructuredRequest.timeoutMs` already exists (`adapters.ts:62`); `web-fetch.ts` already enforces its own timeout |
| Degradation | Drop whole input items from the end of the fixed priority order, never truncate an item, never fail the assembly (REQ-5). A failed reference, an absent issue, a degraded map each degrade the input, not the feature — unless intent is also absent (REQ-11) | The package rule: "Context enrichment is best-effort: on error/unindexed, omit the section, don't throw" (`server/CLAUDE.md`) |
| Observability | One structured record per assembly: source list, resolved and skipped references by source with reasons, estimated input tokens, `tokensIn`/`tokensOut`, cost, discard count, dropped-item list, resolved model (REQ-15) | A brief that quietly shrank its own input must be explainable without logging the input |
| Observability — safety | No input content in any log or record. A dropped or skipped item is named by source and reason, never by content; a discarded reference string is recorded only where it is already a repository path — never issue or document prose | The safety contract at `reviews/prompt-log.ts:14-21`, asserted against planted secrets by `server/test/prompt-log.test.ts` |
| Cost attribution | The brief's cost is returned and recorded on the brief, and is **not** folded into `agent_runs` | `agent_runs` models exactly one review interaction; folding a brief in would double-count it across every agent reviewing the same PR (`server/docs/intent-layer.md:254-258`) |
| Data lifecycle | One row per PR, replaced on regeneration, cascade-deleted with the PR. No history, no TTL, not user-deletable independently of the PR | `pr_brief.pr_id` PK with `ON DELETE CASCADE` (`db/schema/reviews.ts:74-79`). History is D-9's separate spec |
| Test determinism | **No `NODE_ENV=test` guard is needed.** The model call sits behind an explicit user action, so an e2e flow that never presses generate is LLM-free by construction | D-14. Intent needed such a guard precisely because it derives lazily on PR open (`pulls/routes.ts:344-351`); this feature does not, and inheriting the guard would hide a design property behind an environment check |
| External network posture | Unchanged and inherited: `https:` only, resolved-address validation, per-hop redirect re-validation, size and content-type caps, and the whole capability off by default | `adapters/http/web-fetch.ts`; `docs/intent-layer.md:209-225`. This feature adds a **caller**, not a capability |

## 8. Workflow

```mermaid
flowchart TD
  A(("Read: PR Overview opened")) --> B["Verify PR ownership<br/>BEFORE any cache read"]
  B --> C["Read stored brief + recompute the<br/>LOCALLY RECOMPUTABLE fingerprint<br/>components only — no outbound call"]
  C --> D{"Stored brief?"}
  D -- no --> E["Empty state + Generate<br/>NO model call"]
  D -- yes --> F{"Local components<br/>match?"}
  F -- yes --> G["Render Why & Risk card"]
  F -- no --> H["Render marked out of date,<br/>naming the input that moved"]
  E --> P(("User presses<br/>Generate / Regenerate"))
  H --> P
  G --> P
  P --> I["Read the five inputs;<br/>resolve PR-body references<br/>through the shipped guarded resolver"]
  I --> J{"Regenerate, or FULL fingerprint<br/>(local + remote) changed?"}
  J -- no --> G
  J -- yes --> K{"Intent absent AND<br/>blast degraded?"}
  K -- yes --> R["422 — refuse, name both<br/>missing inputs"]
  K -- no --> L["Allow-list from changed files<br/>+ blast map; assemble paths,<br/>counts and hunk RANGES only"]
  L --> M{"Over 8,000<br/>cl100k_base tokens?"}
  M -- yes --> N["Drop whole items from the end<br/>of the priority order; record each"]
  N --> M
  M -- no --> O["ONE structured model call"]
  O --> Q{"Valid against<br/>the schema?"}
  Q -- "no, after retries" --> X["502 — keep any previous brief,<br/>marked out of date"]
  Q -- yes --> S["Filter every reference against<br/>the allow-list; cap risk_level;<br/>store brief + fingerprint"]
  S --> G
  G --> T["Review focus click →<br/>Files changed, file expanded at line"]
```

*The `G → P` edge is what makes an edited linked issue or an edited referenced document
recoverable: the regenerate control is offered on a brief that reads as current, not only on one
marked out of date, because the read path cannot see those two inputs move (D-1a).*

## 9. Module interactions

| From | To | What crosses | On failure | Owns the data |
|---|---|---|---|---|
| client Why & Risk card | server `brief` (read) | PR id → the stored brief, whether its locally recomputable fingerprint components match, its provenance and cost | Render the card's error state; leave `IntentCard` and `BlastCard` untouched | server |
| client Why & Risk card | server `brief` (assemble / regenerate) | An explicit assembly request | Surface the error inline, keep the previous brief on screen marked out of date, never blank the card | server |
| client Why & Risk card | client Files changed tab | A file path and an optional line, as in-app navigation | Open the tab with no scroll target and state the file is not in the current diff | client |
| server `brief` | server `pulls` data (`pull_requests`, `pr_files`, `pr_commits`) | PR row, changed-file paths and counts, hunk ranges parsed locally, the PR body | PR not found → 404; zero changed files → 422 | `pulls` |
| server `brief` | server `intent`, via `container.intent(logger)` | Read-only `get` of the stored `PrIntentRecord` | Continue without it; record `intent: absent`. **Never** `getOrCompute` — that would be a second model call | `intent` |
| server `brief` | server `intent`'s reference resolver | The PR body → resolved plan/spec/ticket documents, under the shipped per-kind caps, the 12 KB budget and the `repo-file → github → url` order. **Reached on the assembly path only** — never on the read path (D-1a) | **Per-reference best-effort:** each fetch is individually wrapped, one failure never affects the others, and none ever fails the assembly. Every skip is recorded by source with a reason | `intent` owns the resolver; the documents belong to the user's repository and to GitHub |
| server `brief` | the repository clone (local filesystem), through that resolver | A repo-relative path under the documentation allow-list → the document's text | **The traversal guard is re-applied at the last gate before the read**, rejecting `..`, a leading `/`, Windows-absolute paths and NUL bytes; a rejected path is never opened and is recorded as skipped | the user's repository — read-only |
| server `brief` | GitHub, via `container.github()` | The linked issue's number, state, title and body; and `#N` references from the body. **Assembly path only** — never on the read path (D-1a) | Continue without them and record their absence; never fail the assembly | GitHub |
| server `brief` | external HTTP, via `container.webFetch` | Only `https://` references from the PR body, and only when `INTENT_EXTERNAL_FETCH_ENABLED` is on | The getter throws `ConfigError` at its default `false`; the caller treats it as "skip external references". No request leaves the machine | third-party — untrusted |
| server `brief` | server `blast` | The `BlastResponse`: `state`, `indexed_sha`, `counts`, `map`, `prior_prs` | `degraded` → continue with an empty map and record it; any error → treat as `degraded` | `blast` (over `repo-intel`'s index) |
| server `brief` | LLM provider, via `container.llm(provider)` for `risk_brief` | One structured request; back come the parsed object, model, `tokensIn`, `tokensOut`, `costUsd`, `attempts` | 502 after the provider's retries; nothing is stored | provider |
| server `brief` | `pr_brief` | The brief document, its fingerprint and its provenance | Write failure → 502; the brief is not reported as stored | server `brief` |

Direction respected: `client → server`, and nothing reaches `reviewer-core`, which this feature
never calls. Cross-module access inside the server goes through a container facade rather than
importing another module's service class — the rule that makes `reviews` use
`container.repoIntel` and `pulls` use `container.intent` (`server/CLAUDE.md`;
`server/docs/intent-layer.md:33-38`). Which seam `brief` uses to reach the blast map and the
reference resolver is the planner's call; that it must not import those service classes
directly is not.

## 10. Contract, data & input provenance

**The brief record.** `risks[]` reuses the shipped `Risk` shape verbatim
(`contracts/brief.ts:77-84`); nothing else in the table exists today, and per D-10 the envelope
is module-local rather than an extension of the shared `PrBrief`.

| Field | Type (in prose) | Required | Meaning | Absent → consumer does |
|---|---|---|---|---|
| `what` | one short paragraph | yes | What the PR changes, in a reviewer's terms | Render the card's empty state — a brief without `what` is not a brief |
| `why` | one short paragraph | yes | Why the change is being made | Render the `what` alone and say the reason is unavailable; never infer it from `what` |
| `risk_level` | one of `high`, `medium`, `low` | yes | Overall merge risk, after grounding and after the REQ-7 cap | Render no level; never default to `low`, which reads as an assessment nobody made |
| `risks[]` | list, may be empty | yes | Concrete risks, in the model's order | Render `brief.noRisks` |
| `risks[].kind` | short noun ("secret", "N+1", "auth surface") | yes | Category, for grouping | Render the title alone |
| `risks[].title` | one line | yes | The risk in one line | Drop the risk — an untitled risk is not readable |
| `risks[].explanation` | prose | yes | Why it is a risk here | Render the title alone |
| `risks[].severity` | one of `high`, `medium`, `low` | yes | This risk's severity | Treat as `low` and exclude it from the REQ-7 cap, so it can never raise the level |
| `risks[].file_refs` | list of allow-listed file paths or endpoint identifiers, may be empty | yes | Where the risk lives | Render the risk with no links — never guess a file from the title |
| `review_focus[]` | ordered list, may be empty | yes | What to read first, most important first | Render the section's empty state; never substitute the diff's own ordering |
| `review_focus[].file` | an allow-listed **changed-file** path | yes | The file to open | Drop the entry |
| `review_focus[].line` | integer inside a hunk of that file at the PR head | no | The line to land on | Link the file with no line anchor |
| `review_focus[].reason` | one line | yes | Why this one is first | Render the reference with no reason |
| `state_fingerprint` | opaque digest over REQ-8's ten components, of which the locally recomputable subset is what the read path compares (D-1a) | yes | What the brief was assembled from (REQ-8) | Treat the brief as out of date (REQ-14) |
| `inputs_used` | list of the source names that contributed | yes | Provenance | Render the brief unattributed and say provenance is unavailable |
| `references_used` | list of source identifiers (repository path, `#N`, or URL) that resolved into the input | no | Which documents the brief actually read | Show nothing; do not read absence as "no references existed" |
| `references_skipped` | list of source identifiers with a reason each | no | What was linked but not read | Show nothing; do not read absence as "nothing was skipped" |
| `discarded_refs` | integer | yes | References dropped by REQ-6 | Show nothing; do not read absence as zero |
| `model` | model identifier | no | Which model produced it | Show "—" |
| `cost_usd` | number or null | no | Cost of the one call | Show "—" via the shipped `formatCost`, never "$0.00" |
| `tokens_in`, `tokens_out` | integers | no | The provider's own counts | Show "—"; these are the ground truth against which REQ-4's estimate is judged |
| `generated_at` | ISO timestamp | yes | When the model was called — and, under D-1a, the only thing that dates the linked issue and the reference documents the brief read | Show "—"; never "just now" |

**Input provenance.** Five sources feed one model call. `Trust` decides how each may be framed
to the model: every untrusted item is placed inside an `<untrusted source="…">` block, escapes
neutralised, and the system message states that content inside such a block is data whose
instructions are never followed — the pattern already applied to a third-party map at
`blast/summary.ts:49-50, 112` and to intent at `reviewer-core/src/prompt.ts:16-34`.

| Input | Comes from | Trust | Freshness | Absent → feature does |
|---|---|---|---|---|
| Derived intent | `pr_intent` row, read through `container.intent(logger).get` (`intent/service.ts:48-54`) | **Untrusted** — derived from author-controlled PR prose; already carried to the reviewer as `<untrusted source="pr-intent">` | Stale whenever `pr_intent.head_sha` ≠ the PR head; the brief reads and never derives | Assemble without it and record its absence; refuse only if the blast map is also degraded (REQ-11) |
| Blast map | `BlastResponse` (`blast/contract.ts:66-83`), built from `repo_index_state`, `file_edges`, `file_facts` | **Untrusted content, trusted topology** — symbol names, paths and endpoint strings come from a third-party repository, so they are fenced; the *graph* is our own index, which is what makes it authoritative for the allow-list | Valid at `indexed_sha` only, which can lag the head by tens of commits | Continue with an empty map; the allow-list falls back to the changed-file list; risks lose caller and endpoint grounding |
| Diff statistics and changed files | `pull_requests.additions/deletions/files_count` (`db/schema/pulls.ts:22-24`) and `pr_files.path/additions/deletions` (`:36-45`); hunk ranges parsed locally from `pr_files.patch` and never sent | **Untrusted paths, trusted counts** — the paths are third-party strings, the counts are ours. The paths are the primary allow-list | Refreshed by `GET /pulls/:id`; empty on a PR polled but never opened | Refuse with 422 — with no changed files there is no allow-list and nothing to brief |
| Linked issue | `PrDetail.linked_issue` (`contracts/platform.ts:218`), resolved live from GitHub by regex over the PR body (`adapters/github/octokit.ts:126-131`); **never persisted** | **Untrusted** — third-party prose, fenced as `<untrusted source="linked-issue">` per `docs/intent-layer.md:104` | Live at assembly time; can change with no new commit, which is why its digest is in the fingerprint — but that digest is compared only at the **next assembly**, never on read (D-1a) | Assemble without it and record its absence |
| Specification and plan documents | **The PR body's own references, resolved at assembly time** through the shipped parser and resolver (`modules/intent/references.ts`): repository markdown under the documentation allow-list read from the clone via `container.git.readFile`; `#N` and `github.com/…/issues\|pull/N` references via `getIssue` with a `getPullRequest` fallback; `https://` links only when `INTENT_EXTERNAL_FETCH_ENABLED` is on (default **false**) — all under the per-kind caps and the 12 KB budget (D-13) | **Untrusted**, fenced as `<untrusted source="spec:…">`. Every one of the three kinds originates in text the PR author controls: the *link* is chosen by the author even when the *document* is committed by the team, which is exactly why the repo-file kind is confined to an allow-list of documentation directories and re-checked before the read | Read live at assembly time. A clone document is as fresh as the last `POST /repos/:id/resync`; a GitHub reference is live; an external document is live. Each contributing document's digest is in the fingerprint, so an edit is caught at the **next assembly** rather than on the next read (D-1a) | Assemble without them and record the source list as empty. **A PR that links nothing is the normal case, not a degradation** |
| Feature-model choice | `settings.feature_models.risk_brief` via `resolveFeatureModel` (`platform/feature-models.ts:58-64`) | **Trusted (ours)** | Read per request; in the fingerprint, so changing the model invalidates the cache | Registry default `openai` / `gpt-4.1` (`contracts/platform.ts:63-69`) |
| System message and assembler version | this module's own constants | **Trusted (ours)** | Changes with the code; in the fingerprint | n/a |

**What D-13 does not give us.** The reference input reaches only what the pull request's own body
links. There is **no attachment surface, no per-agent or per-skill selection, and no document
that is not named in the PR body** — a repository can hold a directly relevant specification that
this brief never sees because nobody linked it, and a PR with an empty description contributes
nothing from this source at all. That is the accepted limit of this spec, not an oversight.
**Coordination point:** when `server/specs/project-context/01-project-context.md` lands, attached
documents become a second possible source for this same input. Adopting them changes REQ-2's
source list and REQ-8's fingerprint, so it belongs to a later numbered spec that says so
explicitly — never a silent upgrade of this one.

**Data expectations in prose.** A brief can only be assembled for a PR whose `pr_files` rows
exist — which in practice means the PR has been opened once through `GET /pulls/:id`, since
polling alone imports metadata only. `pr_files.patch` must be present for line grounding to
work; where it is null the file is still allow-listed and its review-focus entries carry no line.
The blast map may legitimately be empty, and an empty map must never be read as "this change
impacts nothing". The stored intent may describe an older head; the brief records which intent
row it used rather than pretending it was current. The linked issue and every GitHub reference
are fetched live and may be unavailable offline. A referenced repository document is read from
the clone, which advances only via `POST /repos/:id/resync`, so it may lag the branch head. Both
of those last two are read at assembly time only, so a stored brief may describe an issue or a
document that has since been edited without the read path being able to say so (D-1a) — which is
why `generated_at` and the provenance list are part of the record rather than debug output. The
`pr_brief` row as shipped has room for the brief document but no field able to hold a fingerprint
or provenance, so REQ-8 and REQ-15 cannot be satisfied by the table as it stands.

**The grounding allow-list**, referenced by REQ-6, is the union of: the PR's changed file paths;
the blast map's `changed_symbols[].file`; its `downstream[].callers[].file`; its
`downstream[].endpoints_affected` and `crons_affected` strings; and `prior_prs[].
overlapping_files`. Of these, only changed-file paths may appear in `review_focus[].file`,
because only a changed file exists on the Files changed tab, and only a changed file's line
numbers are valid at the PR head — a caller's line is valid at `indexed_sha`, which is a
different tree. Risks may cite the whole allow-list. Reference documents contribute **content**
to the input but never **entries** to the allow-list: a path mentioned inside a spec is a claim,
not an observation.

## 11. UX findings & recommendations

| Screen | Finding | Severity | Recommendation | Decision |
|---|---|---|---|---|
| PR Overview | **F-1 — The design's "PR BRIEF" block is the review verdict, not this brief.** It shows "Request changes · 6 findings · 2 blockers", a prose summary, a score ring of 61, `$0.014` and `8.2K→1.3K` — all review output. **There is no card anywhere in either screenshot for `what` / `why` / `risk_level`.** | blocker | Say so plainly: this card is **new design, not an existing screen**. Place it at the top of Overview, above `IntentCard`, where the design puts its "PR BRIEF" block | Adopted — and it is why D-15 gives the new card its own name |
| PR Overview | **F-2 — REVIEW FOCUS is drawn and is the design half that does exist.** Four entries, each a `file:line` reference plus a one-line reason: `src/config.ts:12`, `src/api/public/webhooks.ts:61`, `src/middleware/ratelimit.ts:52`, `src/api/users.ts:46` | should | Adopt the shape verbatim — reference first, reason after an em dash, capped at ~8. Keep the design's own section heading wording | Adopted — REQ-12, §7 |
| Cross-screen | **F-3 — All four REVIEW FOCUS files appear in the Files changed tab's nine changed files**, and each cited line falls inside a rendered hunk | blocker (as evidence) | This validates the rule that `review_focus[].file` may be only a **changed** file with a line inside a hunk at head — the design's own four entries would all pass the grounding filter | Adopted — §10, REQ-6 |
| Files changed | **F-4 — There is no way to enter the tab focused on a file:line.** `lineDomId` (`components/diff-viewer/helpers.ts:18-20`) is rendered only for lines already in `findingLines` (`FileCard.tsx:162, 174-182`), and the only jump trigger is an in-card click (`FileCard.tsx:117-131`). The reverse direction already ships as `?tab=findings&finding=<id>` with a polling scroll (`page.tsx:99-130`) | blocker | REQ-13 needs an entry point in this direction. The `?tab=findings&finding=…` pattern is the shape to mirror; whether that means a query param or an imperative anchor is the planner's call | Adopted — REQ-13 |
| PR Overview | **F-5 — `client/messages/en/brief.json` ships with zero readers** — a fifth instance of the part-0 scaffolding pattern. Usable as-is: `block.risks` (`:5`), `noRisks` (`:8`), `unavailable` (`:11`) | should | Reuse those three. **Do not reuse `why.title` "git-why" / `why.blame` / `why.noHistory` (`:14-17`)** — that block is per-line git blame, a different feature sharing the word "why", and a feature called "PR Why" reaching for those keys would wire itself to the wrong block. Under D-10 the envelope does not compose four blocks either, so **`block.intent`, `block.blast` and `block.history` also stay unused**. New keys are needed for the card title, `what`, `why`, the risk level, the review-focus heading, generate, regenerate and the out-of-date marker | Adopted — D-10, D-15 |
| PR Overview | **F-6 — `brief.unavailableHint` asserts a trigger that is now wrong twice over.** It reads *"Run a review or open the PR to compute it."* — naming a false dependency on a review run, and an automatic compute-on-open that D-14 rejects. A missing key renders the raw key; a wrong key renders a confident lie | should | Replace it with: **"Generate a brief to see what this PR changes, why, and what to review first."** It names the action, promises only what the card delivers, and ties the brief to nothing else | Adopted — D-14 |
| PR Overview | **F-7 — Design-vs-code divergence.** The design's Overview has four blocks; the code ships `IntentCard` + `BlastCard` + PR description (`OverviewTab.tsx:17-36`) | should | **The code wins for what exists** — this spec adds one card and changes neither existing panel. The design's verdict/score/cost block stays unbuilt and out of scope | Adopted — spec follows the code |
| Project Context | **F-8 — `context.json:13`** claims "Every agent and **the PR brief** read them as grounding context" — copy for a brief that did not exist, and under D-13 it is still not true: this brief reads only what the PR body links | idea | That line is already flagged and owned by `project-context/01` §11. Whichever spec lands second must not rewrite it twice, and whichever rewrite lands must not promise the brief reads attached documents until a spec says it does | Recorded — coordination note, not a change here |
| PR Overview | `risk_level` is a three-level band, exactly the shape `IntentCard`'s confidence has | idea | Use `Badge`/`SeverityBadge` with the level as a **word** plus an icon (`Badge.tsx:51-88`). `ConfidenceNum` is percentage-only, and mapping a band to a fake number reintroduces the invented precision the enum exists to avoid | Adopted — `client/INSIGHTS.md` 2026-08-17 |
| PR Overview | `MonoLink` already has an internal `onClick` variant alongside the external `href` variant used in `BlastCard` (`MonoLink.tsx:3-53`, `BlastCard.tsx:220-242`) | idea | Use the `onClick` variant for review focus — in-app navigation, not a GitHub blob link. Nothing new is needed | Adopted |
| PR Overview | **F-9 — The regenerate control cannot be gated on the out-of-date marker.** Under D-1a an edited linked issue or an edited referenced document leaves the card reading as current, so a regenerate affordance offered only on a stale-marked brief would leave the user with no way to pick those edits up | should | Offer regenerate on **every** rendered brief, current or out of date — the §8 `G → P` edge — and place `generated_at` where the user can see how old the brief is. This is what `IntentCard`'s always-present `useRecomputeIntent` button already does (`IntentCard.tsx:68-131`) | Adopted — REQ-10 already says "regardless of any matching stored fingerprint"; this records why it must also be *reachable* regardless |
| All | Only the dark theme at regular density was observable this session — the two screenshots — and the committed bundles could not be opened (`file://` is blocked) | should | The card must be checked in both `data-theme` values and both `data-density` values before it is called done | Recorded — §6 and §14 |

## 12. Traceability

| REQ | ACs | Corner cases | Interactions | Design screen | e2e flow |
|---|---|---|---|---|---|
| REQ-1 | AC-1 | Cardinality zero (no brief, no risks) | client card → server `brief` (read) | new — F-1: no what/why/risk card in the design | 09-pr-brief |
| REQ-2 | AC-2, AC-3, AC-4, AC-5 | Cardinality zero (no references) and many (forty links); Degraded dependency ×7; Freshness ×3 | `brief` → `intent` / reference resolver / clone / GitHub / webFetch / `blast` / LLM | — (server-side) | 09-pr-brief (asserts no call, AC-34) |
| REQ-3 | AC-6 | — | `brief` → `pulls` data | — | 09-pr-brief |
| REQ-4 | AC-7, AC-8 | Cardinality many (300 files) | `brief` → LLM | — | — |
| REQ-5 | AC-9, AC-10, AC-11 | Cardinality many ×3 | `brief` → LLM; `brief` → reference resolver | — | — |
| REQ-6 | AC-12, AC-13, AC-14, AC-15 | Cardinality zero (all discarded); Freshness (`indexed_sha` behind head); Content extremes (invented endpoint) | `brief` → `blast`; `brief` → `pulls` data | REVIEW FOCUS — F-3: all four design entries pass the filter | 09-pr-brief |
| REQ-7 | AC-16, AC-17 | Content extremes (hostile document or body) | `brief` → LLM | — | — |
| REQ-8 | AC-19, AC-20 | Freshness ×4 — including the edited issue/document row, which is **REQ-8-only** (D-1a) | `brief` → `pr_brief`; `brief` → GitHub; `brief` → reference resolver | — | — |
| REQ-9 | AC-18, AC-21, AC-22, AC-34 | Cardinality zero (no brief); Permission & tenancy (ownership before cache read) | client card → server `brief` (read) | — | 09-pr-brief |
| REQ-10 | AC-23, AC-24 | Destructive (double press); Concurrency (two tabs); Loading (in flight); Failure ×2; Freshness (edited issue/document — regenerate is the only way to pick it up, F-9) | client card → server `brief` (assemble) | new — generate / regenerate controls | 09-pr-brief (control present, not pressed) |
| REQ-11 | AC-25, AC-26 | Degraded dependency ×2; Cardinality zero (no changed files) | `brief` → `intent`; `brief` → `blast` | — | — |
| REQ-12 | AC-27, AC-28 | Loading; Failure (read fails); Theme & density; Accessibility (band as a word); Narrow viewport | client card → server `brief` (read) | new card (F-1) + REVIEW FOCUS (F-2) | 09-pr-brief |
| REQ-13 | AC-29, AC-30 | Navigation ×3; Content extremes (long paths); Accessibility (keyboard path) | client card → client Files changed tab | REVIEW FOCUS → Files changed (F-3, F-4) | 09-pr-brief |
| REQ-14 | AC-31 | Freshness ×3 (`indexed_sha` behind head, stale intent, stale clone); Concurrency (head moves mid-assembly); Failure (model call fails) | client card → server `brief` (read) | new — out-of-date marker | — |
| REQ-15 | AC-32, AC-33 | Content extremes (planted secrets); Degraded dependency ×4 (each skip is recorded) | `brief` → `pr_brief`; `brief` → reference resolver | — | — |

## 13. Decisions

Append-only. D-13, D-14 and D-15 record the answers to this spec's blocking questions; D-10 was
confirmed as the fourth. D-1a was appended on 2026-08-27, after the cross-model review of
`docs/plans/pr-why-risk-brief.md`, to record what the plan's fingerprint split traded away; it
amends D-1's consequences without disturbing D-1's own reasoning, which stands unchanged.

| Question | Answer | Date |
|---|---|---|
| D-0: New module or an extension of `pulls`? | **A new `brief` module.** The registry comment names `brief` as a planned lesson module (`modules/index.ts:26`), and the package rule is "new feature = new module + one line in `src/modules/index.ts`" (`server/CLAUDE.md`). `pulls` documents itself as import-and-read only (`pulls/routes.ts:26-28`); making it depend on `intent`, `blast`, a reference resolver and an LLM provider would end that. Route path is not module ownership — `intent`, `blast` and `smart-diff` all own `/pulls/:id/…` routes from their own modules | 2026-08-27 |
| D-1: What "a specific PR state" means | **A fingerprint over every input that can change the answer**, not the head sha alone. Head sha alone is **provably insufficient**, and here are the four counterexamples that prove it: `POST /pulls/:id/intent` re-derives the intent with the head unchanged; `POST /repos/:id/resync` moves `indexed_sha` with the head unchanged; a linked issue can be edited on GitHub with the head unchanged; and the `risk_brief` model can be changed in Settings with the head unchanged. D-13 adds a fifth — a referenced repository document can be edited and re-synced with the head unchanged. In every one of those cases a head-keyed cache would serve a brief that no longer matches its inputs, which is exactly the failure the requirement exists to prevent. This is what makes REQ-8 a requirement rather than a design preference | 2026-08-27 |
| D-1a: What the local/remote fingerprint split trades away *(amends D-1's consequences; D-1 itself stands)* | **The fingerprint is stored whole and compared whole at assembly, but only its locally recomputable half is recomputed on the read path.** Local half: the PR head sha, the stored intent's derivation timestamp and model, the blast map's `indexed_sha` and `state`, the resolved feature-model provider and model, and the assembler version — all readable from our own database and settings. Remote half: the linked issue's number, state and content digest, and the source identifier and content digest of every resolved reference document. All ten components still enter the stored fingerprint, so every one of D-1's five counterexamples still moves it and AC-20 is unaffected. **What it trades away, stated plainly:** recomputing the remote half means a live GitHub call and a set of clone reads on **every PR open** — exactly the work D-14 forbids and §7's 300 ms read budget cannot hold. So an **edited linked issue** and an **edited referenced document** are detected at the **next assembly**, not at the next read: until someone presses generate, the card shows the stored brief as current, and the only things dating it are `generated_at` and the provenance list. Three of D-1's five counterexamples stay read-detectable (head moved, intent re-derived, `indexed_sha` moved) alongside the model change; two do not. This is why REQ-14 is scoped to the locally recomputable components rather than to "the current inputs", why §6's edited-issue/document row belongs to REQ-8 rather than REQ-14, and why F-9 requires the regenerate control on every rendered brief rather than only on a stale-marked one. *Accepted cost, chosen knowingly over a slower read.* Confirmed as the single divergence between this spec and its plan by `docs/plans/pr-why-risk-brief.cross-review.md` (finding 1) | 2026-08-27 |
| D-2: The unit of the token budget | **One `cl100k_base` token, counted by the server's existing tokenizer (`adapters/tokenizer/index.ts:25-40`), over the concatenated system and user messages, falling back to `ceil(chars/4)`.** Identical to the unit and figure the approved `project-context/01` spec fixed, so the two specs cannot disagree about what a token is. This deliberately diverges from two neighbours, for stated reasons: intent's `chars/4` (`intent/classifier.ts:88-90`) is measurement-only and never a limit, so precision costs it nothing, whereas here the number is a limit; and blast's `MAX_TOKENS = 150` (`blast/summary.ts:34`) is an **output** cap handed to the provider's own tokenizer via `CompletionRequest.maxTokens`, a different quantity in a different tokenizer and not comparable. The figure is an **estimate** and is never claimed to be exact; the provider's `tokensIn` (`adapters.ts:75`) is recorded after the call as ground truth, so drift is observable rather than assumed away | 2026-08-27 |
| D-3: Can the brief influence a review? | **No.** The brief is display-only. Nothing on the persistence or scoring path reads it, so a hostile PR description or a hostile referenced document cannot lower a severity or a score through it — the same structural defence the Intent Layer chose, and for the same reason (`server/docs/intent-layer.md:294-336`). The suppression channel does not exist to be disabled | 2026-08-27 |
| D-4: Which blast input the brief consumes | **The blast MAP, rendered deterministically — not the blast summary paragraph.** Three reasons, each independently sufficient: the summary is produced by its own LLM call, so consuming it would make the brief cost two calls; the summary is **never persisted** (`BlastSummaryResponse` is returned and held only in a client mutation cache), so it cannot be a reproducible cache input; and the summary is lossy by design (12 symbols × 6 callers, 150-token output), whereas the grounding guarantee needs the map's `BlastCaller.file`/`.line` pairs. `renderMapForPrompt` (`blast/summary.ts:54-86`) is exactly the deterministic rendering required | 2026-08-27 |
| D-5: What happens with nothing to say | **Refuse when the intent is absent AND the blast map is degraded.** With neither, the only remaining input is a list of file paths, and a "risk brief" derived from file paths alone is invention dressed as analysis. This is the judgement `summariseBlast` already makes for a degraded map (`blast/summary.ts:93-99`). Either one alone is survivable, and the brief says which was missing | 2026-08-27 |
| D-6: Where a brief is stored | **The already-shipped `pr_brief` table** (`db/schema/reviews.ts:74-79`), in the schema since `0000_init.sql:211` with zero writers — the fifth instance of the part-0 scaffolding pattern this repo keeps rediscovering. It gives one row per PR, cascade-deleted with the PR, and tenancy that scopes transitively through `pr_id`, which is precisely why ownership must be verified **before** the cache is read (`server/docs/intent-layer.md:247-252` already names `pr_brief` in that list). Its `{pr_id, json}` shape cannot hold REQ-8's fingerprint or REQ-15's provenance, so the record must be widened | 2026-08-27 |
| D-7: What `risk_level` means | **The model's own judgement, capped by our code at the highest severity among the risks that survived grounding**, treating "no surviving risks" as `low`. It may only ever be lowered, never raised — intent's `min(model band, evidence tier)` rule applied to a different band (`intent/classifier.ts:120-132`). It makes the level falsifiable: a `high` level with three `low` risks is a contradiction the model can no longer ship | 2026-08-27 |
| D-8: Degradation order under the budget | **Drop whole items from the end of a fixed priority order** — resolved reference documents, then linked issue, then blast symbols, then changed files beyond 60 — never truncate an item, never fail. Reference documents go first because they are the least trustworthy and largest input, which is also the order the shipped resolver drops them in (`docs/intent-layer.md:199-202`). Changed files go last because they are the grounding allow-list: cutting them would silently shrink the set of things a risk is allowed to name | 2026-08-27 |
| D-9: The Why Timeline stretch | **Out of scope — a second numbered spec in this module, not part of this one.** It cannot be bolted on: `pr_brief.pr_id` is the primary key, so one PR holds one brief, and a timeline needs one row per (PR, state) with a retention policy nobody has agreed. It also inverts this feature's economics — the whole cache design exists to make repeat opens free, and a per-commit history makes cost grow linearly in commits. And it ships independently: no requirement here depends on it. Deferring it keeps this spec at one agreed change | 2026-08-27 |
| D-10: Which contract home *(answer to blocking question 4)* | **A module-local envelope in the `brief` module, reusing the shared `Risk`/`RiskSeverity` shapes.** This follows the decision L04 recorded verbatim (`blast/contract.ts:1-26`; `server/INSIGHTS.md` 2026-08-23): no route in this server declares a Zod `response:` schema, so a shared response contract buys types only, at the cost of entering `vendor/shared` — a do-not-touch zone with a two-copy byte-identity invariant. **Consequence, stated plainly: the shipped `PrBrief` (`contracts/brief.ts:143-149`) does not gain `what`, `why`, `risk_level` or `review_focus`, and stays dead scaffolding.** Consequently `brief.json`'s `block.intent`, `block.blast` and `block.history` keys also remain unused, alongside the `why.*` git-blame keys already flagged as a trap in F-5 | 2026-08-27 |
| D-11: Which feature-model slot | **`risk_brief`**, already registered as "Risk Brief — Assesses merge risks for a pull request" with default `openai/gpt-4.1` (`contracts/platform.ts:63-69`). This feature is its namesake; blast borrowed it because `FEATURE_MODELS` is in the do-not-touch zone (`blast/summary.ts:21-23`) and continues to. No registry edit, and therefore no edit to the third hand-mirrored copy at `client/src/lib/feature-models.ts` | 2026-08-27 |
| D-12: How intent is read | **`get`, never `getOrCompute`.** Deriving intent inside the brief would make the feature cost two model calls and would violate REQ-2. The brief reads whatever is stored, records that it may be stale, and pins it in the fingerprint | 2026-08-27 |
| D-13: Where the "relevant specs" input comes from *(answer to blocking question 1)* | **Re-resolve the PR body's own references at assembly time**, through the shipped parser and resolver (`modules/intent/references.ts`), under the same documentation-directory allow-list, the same traversal guard re-checked at the last gate before a read, the same per-kind caps (5 repo files / 5 GitHub / 3 URLs), the same 12 KB budget, the same `repo-file → github → url` resolution order, and the same `INTENT_EXTERNAL_FETCH_ENABLED` flag at its default **false**. Chosen over waiting for `project-context/01` (which would block this lesson on another) and over shipping with four inputs (which would drop a source the assignment names). It adds a caller, not a capability: no new parser, no new fetcher, no new security surface. **What it does not give us: no attachment UI, no per-agent or per-skill selection, and no document that the PR body does not itself reference** — a repository can hold a directly relevant spec this brief never sees. **Coordination point:** when `project-context/01` lands, attached documents become a *second possible source* for this input; adopting them changes REQ-2 and REQ-8 and is therefore a later numbered spec's explicit decision, never a silent upgrade of this one | 2026-08-27 |
| D-14: When the model is called *(answer to blocking question 2)* | **On an explicit press only.** Opening a pull request performs a cache-only read that never calls a model; assembly happens when the user presses generate, and thereafter on regenerate. Chosen over intent's lazy-derive-on-open because it satisfies the course's cache criterion **exactly** — re-opening the same PR state reads stored state with no model call, by construction rather than by a fingerprint comparison that happens to hit — and because it keeps the e2e flow LLM-free **structurally** rather than by relying on a `NODE_ENV=test` guard. Intent needed that guard precisely because it derives on open (`pulls/routes.ts:344-351`); this feature does not need one, and inheriting it would hide a design property behind an environment check. It also means no first open of any PR ever spends money the user did not ask for. Consequence: the shipped `brief.unavailableHint` — *"Run a review or open the PR to compute it."* — is wrong twice over and is replaced with *"Generate a brief to see what this PR changes, why, and what to review first."* (F-6) | 2026-08-27 |
| D-15: What the card is called *(answer to blocking question 3)* | **"Why & Risk".** The design already binds the label "PR BRIEF" to the review verdict block — verdict, findings count, score 61, cost — so giving the new card that name would put two different things under one label on one screen. The design's block keeps "PR Brief" for whenever it is built, and **nothing shipped is renamed**. To be explicit, because the next reader will otherwise think these disagree: the **module, the route and the stored record all stay `brief`** (`modules/brief`, `/pulls/:id/brief`, `pr_brief`); only the **user-facing label** is "Why & Risk" | 2026-08-27 |

## 14. Assumptions & open questions

**Assumptions in force**

- The estimate produced by `cl100k_base` is materially wrong in absolute terms against a Claude-
  or GPT-4.1-family tokenizer; the approved sibling spec records the same assumption from the
  same evidence. This spec never claims accuracy, only a fixed and reproducible unit (D-2).
  *Invalidated by:* adopting an exact counting mechanism, which would let the "estimate"
  qualifier be dropped from REQ-4 and AC-7.
- 8 000 estimated input tokens plus 900 output tokens is comfortably affordable for the models in
  the `risk_brief` slot. *Invalidated by:* a workspace selecting a model whose context window
  cannot hold it, which would make the budget model-dependent rather than fixed.
- **The grounding filter stops invented references; it cannot stop misdirection.** A hostile PR
  description — or now, under D-13, a hostile *referenced document* — could steer the model
  toward a real but irrelevant file, or away from a real risk. Fencing and the system message are
  the only mitigations and both are behavioural. The mechanical defence is D-3: the brief cannot
  change a finding or a score, so misdirection costs a reviewer attention, never a missed
  severity. *Invalidated by:* any future change that lets the brief feed the review path.
- D-13 widens the untrusted-input surface from four sources to five, and the fifth can carry
  document-length prose. The shipped resolver's caps and budget bound its size, and
  `wrapUntrusted` bounds its ability to break out of its block, but nothing bounds its
  persuasiveness. *Invalidated by:* evidence that a fenced 12 KB document can steer this model's
  `risk_level` — which would make the cap in D-7 the only defence rather than a second one.
- **Under D-1a, a brief that reads as current may have been assembled from a linked issue or a
  referenced document that has since been edited, and nothing on the read path can say so.** The
  assumption in force is that a reviewer who cares reaches for regenerate — which F-9 keeps
  available on every brief — and that `generated_at` plus the provenance list are enough to
  prompt that. *Invalidated by:* a walkthrough in which a reviewer trusts a stale brief because
  the card looked current, which would make read-time remote detection worth its cost and reopen
  the §7 read budget.
- `pr_files.patch` is present for the PR's changed files, which is what makes line grounding
  possible. *Invalidated by:* a PR whose patches GitHub omitted (very large files), where those
  files get file-level references only.
- A model asked for `what` and `why` from headers, an intent statement, a dependency map and
  linked prose will produce something a reviewer finds useful. Nothing in this spec tests
  usefulness — only shape, grounding and cost. *Invalidated by:* a walkthrough where the `why`
  merely restates the title.
- Only the dark theme at regular density was observable this session; the committed design
  bundles could not be opened because `file://` is blocked in the browser tool
  (`client/INSIGHTS.md` 2026-08-02, re-confirmed today). Every claim about the design comes from
  the two screenshots. *Invalidated by:* decoding the bundles, which may show a what/why/risk
  card this spec has recorded as absent (F-1).

**Open (non-blocking)**

- Should the brief appear anywhere other than the PR Overview tab — for example as a risk-level
  column on the PR list? — product owner.
- Should `discarded_refs` be surfaced to the user, or only recorded? A visible count is honest
  but reads as an error the user cannot act on — product owner.
- Should `references_skipped` be shown on the card, the way the trace drawer shows "Specs read"
  for a review? It is the same information for a different consumer — product owner.
- Should the `Tabs` primitive's missing `role="tab"`/`aria-selected` be fixed? Already open in
  `project-context/01` §14; this card adds no tabs, so it inherits the question rather than
  raising it — front-end owner.
- Is `09` still free for the e2e flow at implementation time? `01`–`07` exist on disk and `08` is
  claimed by the approved `project-context/01` spec but is not yet written.

## 15. Done means

A reviewer can: open a pull request and see the **Why & Risk** card in its empty state with a
generate control, confirming that opening a PR costs nothing; press generate once and get a brief
stating what the PR changes and why, with one risk level shown as a word; read risks whose file
references all exist in the PR's diff or its blast map; click a review-focus entry and land on
the Files changed tab with that file expanded and that line in view; close the PR and re-open it
and see the brief appear with no model call and no cost; move the head, or recompute the intent,
or re-index the repository, or change the `risk_brief` model in Settings, and see the brief marked
out of date naming which input moved; edit the linked issue or a referenced document instead, and
see the card still read as current with its `generated_at` and provenance unchanged — then press
generate and get a brief whose fingerprint has moved, which is D-1a's accepted trade made visible;
press regenerate on a brief that is not marked out of date and get a new brief replacing the old
one; link a plan in the PR body and see it named in the brief's provenance, and link a path
outside the documentation allow-list and see it recorded as skipped without ever being read; and
open a PR whose repository is unindexed and whose intent was never derived, and get a clear
refusal naming both rather than a confident brief about nothing. A planted string inside a diff
hunk body never reaches the model, and a planted secret in a linked issue or a referenced document
never reaches a log.

AC-1 through AC-34 pass, and an e2e flow named `09-pr-brief.flow.json` covers the empty state,
the stored-brief read, the out-of-date marker and the review-focus click-through — calling no
LLM, which it achieves by never pressing generate rather than by any environment guard.

## Sources

**Design**
- Screenshot, PR Overview (`/repos/…/pulls/482?tab=overview`) — PR BRIEF verdict block (Request
  changes, 6 findings · 2 blockers, score 61, `$0.014`, `8.2K→1.3K`), INTENT panel, BLAST RADIUS
  panel, and REVIEW FOCUS — READ THESE FIRST with four `file:line` entries and reasons
- Screenshot, Files changed (`?tab=diff`) — reviewer-ordered diff, Core logic / Wiring /
  Boilerplate, per-file "What this does", blocker and warning markers, nine changed files
- `client/specs/DevDigest Design (standalone).html` and `… (3).html` — **not opened**: `file://`
  is blocked in the browser tool (attempted this session; recorded in `client/INSIGHTS.md`
  2026-08-02)

**Contracts and schema**
- `server/src/vendor/shared/contracts/brief.ts:15-41, 44-71, 74-89, 143-149` — `Intent`,
  `BlastRadius`/`BlastCaller`/`DownstreamImpact`, `Risk`/`Risks`/`RiskSeverity`, the unimplemented
  `PrBrief`; byte-identical to the client copy
- `server/src/vendor/shared/contracts/platform.ts:17-24, 46-84, 162-224` — `FeatureModelId` incl.
  `risk_brief`, `FEATURE_MODELS`, `PrMeta`/`PrFile`/`IssueMeta`/`PrDetail.linked_issue`/
  `PrDetail.intent`
- `server/src/vendor/shared/contracts/review-api.ts:64-70` — `PrIntentRecord`
- `server/src/vendor/shared/adapters.ts:35-88` — `CompletionRequest.maxTokens`,
  `StructuredRequest`, `StructuredResult.{tokensIn,tokensOut,costUsd,attempts}`
- `server/src/db/schema/reviews.ts:48-79` — `pr_intent`, and `pr_brief` `{pr_id, json}` with no
  writer; `server/src/db/migrations/0000_init.sql:211, 386`
- `server/src/db/schema/pulls.ts:5-56` — `pull_requests`, `pr_files.patch`, `pr_commits`
- `server/src/db/schema/repo-intel.ts:29-88` — `repo_index_state.lastIndexedSha`, `file_edges`,
  `file_facts`

**Server**
- `server/src/modules/index.ts:26, 29-43` — registry; `brief` named as a planned lesson module
- `server/src/modules/pulls/routes.ts:26-28, 241-383` — the two exit points of `GET /pulls/:id`,
  lazy intent derivation, the `NODE_ENV=test` guard and its stated reason
- `server/src/modules/intent/{routes.ts:21-41, service.ts:48-95, classifier.ts:43-56, 88-90,
  120-146, 208-219, references.ts:47-66, constants.ts:5-26}` — routes and rate limit,
  `get`/`getOrCompute`/`compute`, narrower `ModelIntent`, `chars/4` estimate, confidence cap,
  single structured call, header-only diff, `isSafeRepoPath`, `REFERENCE_DOC_DIRS`, the 60-file cap
- `server/src/modules/blast/{routes.ts:22-61, contract.ts:1-91, service.ts:54-96, 183-194,
  summary.ts:9-34, 49-51, 54-121}` — both routes and the 5/min limit, `BlastResponse` with
  `indexed_sha`/`state`/`prior_prs`, the degradation gates, `MAX_TOKENS = 150` as an output cap,
  `renderMapForPrompt`, the untrusted fence, the degraded refusal
- `server/src/modules/smart-diff/routes.ts:7-23` — `GET /pulls/:id/smart-diff`, uncached, no model
- `server/src/modules/reviews/prompt-log.ts:14-21` — the content-free observability contract
- `server/src/adapters/http/web-fetch.ts` — the SSRF-hardened fetcher behind the flag
- `server/src/platform/{feature-models.ts:10-64, errors.ts:7-41, config.ts:29-34}`,
  `server/src/app.ts:95-97` — model resolution, error taxonomy, the external-fetch flag, 120/min
- `server/src/adapters/{tokenizer/index.ts:14-40, github/octokit.ts:126-131, 351-356,
  llm/openai.ts:18-39, mocks.ts:92-95}` — `cl100k_base` + `approxTokens`, linked-issue regex,
  `maxTokens` → `max_tokens`, the structured-fixture `safeParse`
- `reviewer-core/src/prompt.ts:16-34` — `INJECTION_GUARD`, `wrapUntrusted`

**Client**
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:5, 40-44, 68-130, 190-236` — `?tab`
  state, id resolution, the `?tab=findings&finding=…` jump and its polling scroll, tab dispatch
- `…/_components/{OverviewTab/OverviewTab.tsx:17-36, IntentCard/IntentCard.tsx:34-131,
  BlastCard/BlastCard.tsx:27-242, DiffTab/DiffTab.tsx:26-108,
  SmartDiffViewer/{SmartDiffViewer.tsx:14-99, constants.ts:9-55}}` — what Overview ships, the
  recompute-button template, `CallerLink`'s indexed-sha guard, Smart/Original toggle
- `client/src/components/diff-viewer/{helpers.ts:18-20, FileCard/FileCard.tsx:33-190}` —
  `lineDomId` gated on `findingLines`, the in-card jump
- `client/src/lib/{api.ts:21-74, hooks/{core.ts:102-120, blast.ts:41-84, intent.ts:7-22,
  smart-diff.ts:15-21}, feature-models.ts:28-34}` — single entry point, hooks, no brief hook, the
  third feature-model mirror
- `client/src/vendor/ui/primitives/{Badge.tsx:5-88, MonoLink.tsx:3-53, Button.tsx:10-87}`
- `client/messages/en/brief.json:1-19` (zero readers), `context.json:13`

**Docs and prior findings**
- `server/docs/intent-layer.md` (whole) — context sources and caps, header-only guarantee, the
  reference parser and its three kinds, per-kind caps, 12 KB budget, resolution order, the
  external-fetch guard and its flag, caching and the ownership-before-cache rule naming
  `pr_brief`, cost attribution, known limits
- `server/specs/project-context/01-project-context.md` (status `approved`) — the `cl100k_base`
  estimate decision, the 8 000-token budget precedent, and its own out-of-scope note that
  PR-brief consumption is not part of it
- `docs/research/l04-blast-radius-plan.md`; `server/src/modules/blast/README.md:101-106`
- `server/INSIGHTS.md` (2026-08-02, 2026-08-17, 2026-08-20, 2026-08-23) · `client/INSIGHTS.md`
  (2026-08-02, 2026-08-17, 2026-08-23) · `e2e/INSIGHTS.md` (empty) — scoped reads for the three
  touched packages
- researcher: *What does the L03 intent module ship and what is its persisted/contract shape?* →
  two routes, `head_sha`-keyed cache, single `temperature: 0` structured call, header-only diff,
  **no grounding of model output at all**, ownership checked before every cache read
- researcher: *What does the L04 blast module ship — map, summary, caching, contract?* → no blast
  table and no cache; the summary is an LLM paragraph, **not persisted**, capped at 150 **output**
  tokens by the provider's own tokenizer; `BlastCaller.file`/`.line` is the only groundable
  `file:line` pair in the contract
- researcher: *What ships on the client PR page, and what pre-shipped brief copy/hooks exist?* →
  Overview ships `IntentCard` + `BlastCard` only; `brief.json` has zero readers; no `risk_level`
  or `review_focus` anywhere; `lineDomId` is rendered only for finding lines and has no external
  entry point

**Revision of 2026-08-27 (D-1a)**
- `docs/plans/pr-why-risk-brief.cross-review.md:27, 41-62` — finding 1, confirmed, and its
  instruction that the spec is the side to change
- `docs/plans/pr-why-risk-brief.md:18` (BQ-1/A), `:238-241` (S7 — the local/remote split and
  which two components move only `remote`), `:270` (S11 — "recompute the **local** fingerprint
  only" on the read path), `:488` ("What BQ-1/A gives up, stated plainly")
