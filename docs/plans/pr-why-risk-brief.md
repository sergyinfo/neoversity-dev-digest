# Implementation Plan: PR Why + Risk Brief

- **Spec:** `server/specs/brief/01-pr-why-risk-brief.md` (status `approved`, 2026-08-27) — binding. 15 EARS requirements, 34 acceptance criteria, 16 decisions D-0…D-15.
- **Plan date:** 2026-08-27
- **Execution mode agreed: MULTI-AGENT, 13 agent invocations.** The per-track table under *Execution — multi-agent run* is the operative decomposition. The single-agent pass is retained below it as the recorded alternative, not as an option still open.
- **Blocking questions:** 5 raised, 5 answered — see *Decisions taken*.
- **Recommendations:** R1–R5 accepted and planned into the steps; R6 rejected.
- **Next stage: `/cross-review`** — an independent read by a model from another family — **not `/impl`**. No code is written until that review returns.

---

## Decisions taken

`plan-verifier` reads this plan, not the conversation that produced it. Every choice below was made by the user on 2026-08-27; the planner recommended each one and none was decided silently.

| ID | Question | Chosen | One-line reasoning |
|---|---|---|---|
| **BQ-1** | What does the *read* route compute the current fingerprint from? | **A — split fingerprint** | A local half (5 DB/settings components) is computed on read so the Overview open stays DB-only and fast; the remote half (issue digest, document digests) is stored on the brief and re-derived only at assembly, because resolving references on every PR open is exactly the work D-14 forbids and would break §7's 300 ms read budget. |
| **BQ-2** | Whole-document drop vs. the shipped resolver's truncation | **A — opt-in `dropWholeItems`** | An additive `dropWholeItems?: boolean` on `ResolveDeps`, defaulting to `false`, leaves intent byte-identical while letting brief honour D-8's "never truncate an item, a cut 'must not' inverts it". |
| **BQ-3** | How does brief learn which references were skipped and why? | **A — return `{ resolved, skipped }`** | The reasons already exist in `resolveReferences`' local `skipped` array and currently reach only a log line; surfacing the existing array is the smallest honest change, and there is exactly one in-repo caller to update. |
| **BQ-4** | Widen the `pr_brief` **table** or the JSON document? | **A — add columns, migrate** | The read path compares a scalar `state_fingerprint` column rather than a JSON path expression, and provenance stays queryable separately from the brief document, which remains in `json`. |
| **BQ-5** | How is AC-29 verified, and does the seed change? | **A — split it, and patch the seed** | AC-29 was unverifiable as written; the e2e flow now asserts the navigation, a client unit test asserts the scroll via the `scrollIntoView` spy, and the seeded `src/config.ts` row gains a `patch` so line 12 exists in the DOM at all. |

| ID | Recommendation | Status |
|---|---|---|
| **R1** | `Badge` + a local `RISK_META`; never `SeverityBadge` | **Accepted** — planned into S15 |
| **R2** | A cached `container.blast` getter; import the resolver functions directly | **Accepted** — planned into S5 |
| **R3** | Brief integration suite on a `NODE_ENV=development` config | **Accepted** — planned into S11/S12 |
| **R4** | Response envelope declared locally in the hook; `lib/types.ts` untouched | **Accepted** — planned into S13 |
| **R5** | Append INSIGHTS entries for the three findings | **Accepted** — planned into S20 |
| **R6** | An MCP `get_brief` tool | **Rejected** — considered and declined; recorded in *Risks* so it reads as a decision, not an oversight |

---

## Requirements review

| # | Requirement (as given) | Verdict | Evidence / what settles it |
|---|---|---|---|
| REQ-1 | Brief carries `what`, `why`, one `risk_level`, `risks[]`, ordered `review_focus[]` | clear | Confirmed absent: `grep -rn "risk_level\|review_focus" server/src client/src e2e` returns **nothing**. Shipped `PrBrief` is `{intent, blast, risks, history}` (`server/src/vendor/shared/contracts/brief.ts:143-149`) |
| REQ-2 | Five named inputs, exactly one structured call, on explicit request | clear | No `brief` module: `server/src/modules/index.ts:29-43` registers 13 modules, none of them `brief`; `:26` names `brief` as a planned lesson module |
| REQ-3 | No diff hunk **bodies** in the model input; paths, counts, `@@` ranges only | clear | Precedent verified at `server/src/modules/intent/constants.ts:73-75` (system prompt states header-only) |
| REQ-4 | ≤ 8 000 estimated `cl100k_base` tokens, `ceil(chars/4)` fallback | clear | `TiktokenTokenizer` + `approxTokens` verified verbatim at `server/src/adapters/tokenizer/index.ts:21-39`; on the container at `platform/container.ts:134-138` |
| REQ-5 | Drop whole items from a fixed priority order; never truncate; never fail | **was conflicting — resolved by BQ-2** | Two spec norms disagreed: **D-13** said reuse the shipped resolver and *add none of it*, while **D-8 and AC-11** required whole-document drops. The shipped resolver **truncates** the document that straddles the 12 KB budget — `item.content.slice(0, remaining) + "\n…[truncated]"` at `server/src/modules/intent/references.ts:185-192`. Resolved by an opt-in flag that keeps intent byte-identical (BQ-2/A, S4) |
| REQ-6 | Discard every model reference not in the allow-list; count; never repair | clear | Intent does no grounding at all (`intent/classifier.ts` returns free-text scope) — genuinely new |
| REQ-7 | Cap `risk_level` at the highest surviving severity; only lower | clear | Mirrors the confidence cap; pure function, unit-testable |
| REQ-8 | State fingerprint over ten named inputs | clear | `pr_brief` is `{prId, json}` only — verified at `server/src/db/schema/reviews.ts:74-79`. `grep -rn prBrief server/src` returns **zero writers and zero readers**. Split local/remote per BQ-1/A |
| REQ-9 | Model called only on explicit assembly | clear | No `NODE_ENV=test` guard needed; the guard that exists is `pulls/routes.ts` `deriveIntentForDetail` (`if (container.config.nodeEnv === 'test') return null`) and is not on this path |
| REQ-10 | Regenerate ignores a matching fingerprint and replaces the stored brief | clear | Mirrors `IntentService.compute` (`intent/service.ts:87-95`), verified |
| REQ-11 | Refuse when intent absent **and** blast degraded; name both | clear | Mirrors `summariseBlast`'s degraded refusal (`blast/summary.ts:93-99`), verified verbatim |
| REQ-12 | **Why & Risk** card on Overview | clear | `OverviewTab.tsx:17-36` renders `IntentCard` + `BlastCard` + description only. Confirmed |
| REQ-13 | Review-focus entry → Files changed, file expanded, line in view | clear | F-4 confirmed: `FileCard.tsx:174-182` renders `id={lineDomId(...)}` **only** on lines already in `findingLines` (`:162`). No query-param entry point exists |
| REQ-14 | Out-of-date marker naming which input moved | **was ambiguous — resolved by BQ-1** | Required the *current* fingerprint on every read, against §7's 300 ms budget "with no outbound call other than the reads needed to compute the fingerprint". Resolved: the marker names only the **local** input that moved (BQ-1/A) |
| REQ-15 | Content-free provenance record | clear | Contract to copy verified at `server/src/modules/reviews/prompt-log.ts:1-38`; its planted-secret test at `server/test/prompt-log.test.ts:8-16` |
| — | `pr_brief` table, `Risk`/`RiskSeverity`, `risk_brief` slot, reference parser/resolver + its whole security posture, `wrapUntrusted`, `completeStructured`, tokenizer, `Badge`/`MonoLink`/`Button`/`EmptyState`, `brief.json` copy, error taxonomy, `renderMapForPrompt`, blast degradation, linked-issue resolution, diff statistics, smart-diff tab | **already built** | All sixteen re-verified this session — see *Existing scaffolding check*. **No step below rebuilds any of them** |
| — | `reviewer-core` changes | correctly out of scope | D-3; no step touches it |

**Two spec claims that did not survive verification.** Both are carried into the steps as corrections, not softened:

1. **`SeverityBadge` will not typecheck against `RiskSeverity`.** §11 recommends `Badge`/`SeverityBadge` (`Badge.tsx:51-88` — which *is* `SeverityBadge`) for `risk_level`. `SeverityBadge` takes `severity: Severity`, and `SEV` is keyed `CRITICAL | WARNING | SUGGESTION | INFO` (`client/src/vendor/ui/primitives/tokens.ts:6-14`). `RiskSeverity` is `high | medium | low`. It is a compile error, not a style preference. → **R1, S15.**
2. **AC-29 was unverifiable as written.** Marked `Verified by: e2e flow`, but (i) the runner's assertion vocabulary is `wait --url` / `wait --text` / `find role|text|label` only (`e2e/README.md` — "we never use the AI `chat` command"), so scroll position cannot be asserted; and (ii) all four seeded `pr_files` rows carry **`patch: null`** (`server/src/db/seed.ts:120-125`), so `FileCard` renders `diffViewer.noDiffText` and line 12 does not exist in the DOM. → **BQ-5/A, S17 + S18 + S19.**

---

## Blocking questions

**None outstanding.** Five were raised and all five are answered — recorded in *Decisions taken* above with the option chosen and the reasoning. The full option sets are preserved below so a later reader can see what was traded away, not merely what was picked.

| # | Question | Options considered | Chosen | What was given up |
|---|---|---|---|---|
| BQ-1 | What does the read route compute the current fingerprint from? | **A** split local/remote · B full fingerprint on every read · C local + an explicit "check for updates" control | **A** | **An edited linked issue, or an edited referenced repository document, is detected at the next *generate*, not at the next *open*.** AC-20's five cases all still move the fingerprint — asserted directly against the fingerprint function in `brief-fingerprint.test.ts` — but only four of the five are observable on the read path. B would have caught all five on read at the cost of a live GitHub call and clone reads per PR open |
| BQ-2 | Whole-document drop vs. the shipped truncation | **A** opt-in `dropWholeItems` · B post-filter on the `…[truncated]` marker · C accept truncation | **A** | Nothing material. One additive parameter on `ResolveDeps`; intent's default path is byte-identical |
| BQ-3 | How brief learns which references were skipped and why | **A** return `{resolved, skipped}` · B an `onSkip` callback · C re-implement in brief | **A** | A one-line signature change at the single in-repo call site (`intent/service.ts:133`) and its test. B would have been additive but gives two ways to observe one thing |
| BQ-4 | Widen the table or the JSON document | **A** add columns + migrate · B everything in `json` · C a new `pr_brief_state` table | **A** | A migration in a do-not-touch zone — unavoidable, and isolated to its own step (S3). C would have contradicted D-9, which reserves per-(PR, state) rows for the Why Timeline |
| BQ-5 | How AC-29 is verified; does the seed change | **A** split + seed patch · B split without the seed · C leave it e2e-only | **A** | `server/src/db/seed.ts` enters the file set. In exchange, "line 12" becomes observable for the first time and flow `05` becomes meaningful. C would have left an AC permanently unverifiable |

---

## Recommendations

Recorded separately from the steps. R1–R5 were **accepted** by the user and are therefore planned in; R6 was **rejected** and appears in no step.

| # | Recommendation | Severity | Cost | Enlarges scope? | Status |
|---|---|---|---|---|---|
| R1 | Render `risk_level` and `risks[].severity` with **`Badge`** plus a local `RISK_META` map (colour + `IconName` + word), mirroring `IntentCard/constants.ts:10-32` — **not** `SeverityBadge`, whose `Severity` union is `CRITICAL\|WARNING\|SUGGESTION\|INFO` and will not accept `high\|medium\|low`. This is what §6's "a word plus an icon, never colour alone" and `client/INSIGHTS.md` 2026-08-17 already prescribe | **blocker** | ~15 lines in a new `constants.ts` | No | **Accepted → S15** |
| R2 | Reach the blast map through a **cached getter** `container.blast`, not a method. `BlastService`'s constructor takes only the container (`blast/service.ts:31`) — it holds **no per-request logger**, so `server/INSIGHTS.md` 2026-08-20's method-not-getter rule (which exists precisely because `IntentService` *does* take `req.log` and a cached getter would pin the first request's logger onto every later one) does not apply here. Reach the reference resolver by importing `parseReferences`/`resolveReferences` directly: they are pure functions, not a service class, and `intent/service.ts:5-11` already documents this exact carve-out | should | one getter, ~4 lines in `platform/container.ts` | No | **Accepted → S5** |
| R3 | Run the brief integration suite against a **`NODE_ENV=development`** config, following `intent.it.test.ts:20-21`. `app.ts:95-97` registers `@fastify/rate-limit` only when `nodeEnv !== 'test'`, so the per-route 5/min override is inert under a test-config app and **AC-24 would silently pass by never rate-limiting anything** | should | one line in the new IT file | No | **Accepted → S11, S12** |
| R4 | Do not add the brief to `client/src/lib/types.ts`. Declare the response envelope locally in `client/src/lib/hooks/brief.ts`, following `hooks/blast.ts:31-56` and `hooks/repo-intel.ts`, reusing `Risk` from `@devdigest/shared`. This is what keeps D-10 true on the client too | should | none — it is the cheaper path | No | **Accepted → S13** |
| R5 | Append one `server/INSIGHTS.md` entry recording the resolver's truncate-vs-drop divergence and `pr_brief` as the **sixth** confirmed part-0 zero-writer scaffolding instance (after `pr_intent`, `BlastRadius`, `blast.json`, `brief.json`, `Risk`); and one `client/INSIGHTS.md` entry recording `SeverityBadge`'s union mismatch | idea | two appended entries | No | **Accepted → S20** |
| R6 | Add an MCP `get_brief` tool alongside `mcp/src/tools/get-blast-radius.ts` | idea | a new tool + its wiring | **Yes** | **Rejected** — considered and declined; the spec never mentions `mcp/` and no step touches it |

---

## Goal & scope

Build the `brief` server module and the **Why & Risk** card, so a reviewer can generate — on an explicit press — a grounded brief for a pull request stating what it changes, why, one capped risk level, concrete risks pointing at real files, and an ordered review-focus list that navigates into the Files changed tab at that file and line. Re-opening the PR serves the stored brief with no model call; a state fingerprint decides cache hit vs. out-of-date; a regenerate control forces re-assembly. Done means AC-1…AC-34 pass and `e2e/specs/09-pr-brief.flow.json` runs LLM-free.

**Out of scope — the executing agent must NOT do these:**

- Touch `reviewer-core/` in any way (D-3).
- Enter `server/src/vendor/shared/` or `client/src/vendor/shared/`. The envelope is module-local (D-10). `PrBrief` (`contracts/brief.ts:143-149`) stays dead scaffolding and gains **no** fields.
- Edit `FEATURE_MODELS` or `client/src/lib/feature-models.ts` (D-11) — `risk_brief` already exists at `contracts/platform.ts:20, 63-69`.
- Rebuild the reference parser, resolver, documentation allow-list, traversal guard, per-kind caps, 12 KB budget, or `web-fetch.ts` (D-13). S4 makes **two additive changes** to `references.ts` and nothing else.
- Call `container.intent(...).getOrCompute` — only `.get` (D-12).
- Call `POST /pulls/:id/blast/summary` or consume its paragraph (D-4).
- Add a second model call, per-risk elaboration, a re-ask, or any fan-out (D-4).
- Add lazy assembly on PR open, on import, on poll, or after a review run (D-14).
- Add a `NODE_ENV=test` guard to any brief path (§7 *Test determinism*).
- Rename the design's "PR Brief" verdict block (D-15) or rewrite `client/messages/en/context.json:13` (F-8 — owned by `project-context/01`).
- Reuse `brief.json`'s `why.*` git-blame keys, or `block.intent` / `block.blast` / `block.history` (F-5).
- Build the Why Timeline (D-9), a project-context attachment surface (D-13), or an MCP tool (R6, rejected).
- Hand-write migration SQL.

---

## Affected packages

| Package | Why it's touched | Risk |
|---|---|---|
| `server/` | New `brief` module; `pr_brief` widened + its own migration; `intent/references.ts` extended (BQ-2, BQ-3); `platform/container.ts` gains a blast seam; `modules/index.ts` +1 line; `db/seed.ts` (BQ-5) | **High** — enters `db/migrations/`, edits a second module's shared function, and adds a paid path |
| `client/` | New `WhyRiskCard`; `OverviewTab` wiring; new hook; new i18n keys + one rewrite; `diff-viewer/FileCard` + both viewers + `DiffTab` + `page.tsx` gain a `file:line` entry point | **Medium** — `FileCard` is cross-route and shared by `DiffViewer` and `SmartDiffViewer`; a regression hits every diff view |
| `e2e/` | New `09-pr-brief.flow.json`, README coverage row | Low — additive. `08` is reserved by `project-context/01`; `09` confirmed free (`e2e/specs/` holds `01`–`07`), settling the spec's §14 open question |
| `reviewer-core/` | **Not touched.** D-3 | — |
| `mcp/` | **Not touched.** R6 rejected | — |

---

## Constraints in force

- ESM `.js` extensions on every relative import in `server/` and `e2e/`; **not** in `client/` — source: root `CLAUDE.md`, `server/src/modules/index.ts:2-14`.
- Never hand-write migration SQL: schema file → `db:generate` → `db:migrate`; new columns go in **your own** migration — source: `server/CLAUDE.md`, `server/INSIGHTS.md` 2026-06-14.
- Every handler resolves tenancy via `getContext` / `getWorkspaceId`, and **ownership is verified before the cache is read** — `pr_brief` carries **no `workspace_id`** and scopes transitively through `pr_id`, so a cache hit that skipped the check would serve another tenant's brief while a miss correctly 404'd — source: `server/src/modules/intent/service.ts:69-75`, whose comment names `pr_brief` in exactly this list.
- Cross-module access goes through a container facade, never another module's service class — source: `server/CLAUDE.md`, `server/INSIGHTS.md` 2026-08-20.
- Context enrichment is best-effort: on error/unindexed, omit the section, don't throw — source: `server/CLAUDE.md`.
- Validation is Zod; 422 `validation_error` / `AppError` code / 500 `internal_error` — source: `server/src/app.ts:114-130`, `platform/errors.ts:19-41`.
- Opt into the type provider per module with `withTypeProvider<ZodTypeProvider>()` — source: `intent/routes.ts:18`, `blast/routes.ts:18`.
- **`server/` and `reviewer-core/` test files are never typechecked** (`tsconfig.json` `include: ["src/**/*.ts"]`); the client's **are** — source: `server/INSIGHTS.md` 2026-08-17. A green server typecheck is not evidence the suites pass.
- Client styling is colocated `styles.ts` objects (`satisfies CSSProperties`) + CSS custom properties, **never** Tailwind utilities despite Tailwind v4 being wired up — source: every `_components/*/styles.ts`.
- Client tests use `fireEvent`, never `userEvent.setup()` — `@testing-library/user-event` is not installed and fails at import — source: `client/INSIGHTS.md` 2026-08-02. **This overrides the `react-testing-library` skill's default advice; the repo wins.**
- jsdom does not implement `scrollIntoView`; stub `Element.prototype.scrollIntoView = vi.fn()` — source: `SmartDiffViewer.test.tsx:11-13, 126`.
- The `Button` primitive's variant prop is **`kind`**, not `variant` — source: `client/INSIGHTS.md` 2026-08-17.
- A missing i18n key renders the raw key, not an error — source: `client/INSIGHTS.md` 2026-06-14.
- e2e flows are deterministic and call no LLM — source: `e2e/CLAUDE.md`.
- `INSIGHTS.md` writes are **append-only** — source: root `CLAUDE.md`.
- Integration tests need Docker; under OrbStack export `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` or the `.it.test.ts` files **fail rather than skip** — source: `server/INSIGHTS.md` 2026-08-20.
- **Precedence, to be obeyed by every track:** package `INSIGHTS.md` → package `CLAUDE.md` → root `CLAUDE.md` → skill → general practice.

**Do-not-touch entered:** `server/src/db/migrations/` — **S3 only**, and only via `pnpm db:generate`. Unavoidable: BQ-4/A widens `pr_brief`, which has held `{pr_id, json}` since `0000_init.sql:211`, and that shape cannot express REQ-8's fingerprint as a comparable column. The generated file must be a **new** `00NN_*.sql` (the next after `0012_tidy_firebrand.sql`); `0000_init.sql` is never edited.

**`server/src/vendor/shared/` is NOT entered** (D-10), so the two-copy byte-identity invariant is untouched. Verified clean at plan time: `diff -rq server/src/vendor/shared client/src/vendor/shared` printed nothing. It remains a gate row below, because a stray "this contract belongs in shared" instinct is exactly what that check catches.

---

## Existing scaffolding check

Every item re-verified this session. **Reuse; do not rebuild.** The spec's own audit found sixteen; all sixteen are confirmed present.

| What ships | Where | How the brief uses it |
|---|---|---|
| `pr_brief` table, **zero readers and zero writers** (`grep -rn prBrief server/src` → nothing) | `server/src/db/schema/reviews.ts:74-79`; `0000_init.sql:211` | The storage (D-6). Widened by S2/S3 |
| `Risk` `{kind,title,explanation,severity,file_refs}`, `Risks`, `RiskSeverity` | `server/src/vendor/shared/contracts/brief.ts:74-89` | `risks[]` reuses `Risk` verbatim; imported, never restated |
| `risk_brief` feature-model slot, "Risk Brief", default `openai/gpt-4.1` | `contracts/platform.ts:20, 63-69` + `platform/feature-models.ts:57-64` | `resolveFeatureModel(container, workspaceId, 'risk_brief')`. **No registry edit** (D-11) |
| `parseReferences` / `resolveReferences`; `isSafeRepoPath` rejecting `..`, leading `/`, Windows-absolute and NUL, **re-checked in `fetchOne` as the last gate before the read**; `REFERENCE_DOC_DIRS`; caps 5/5/3; 12 KB budget; `repo-file → github → url` order | `modules/intent/references.ts:57-241`, `constants.ts:6-18` | Called as-is, plus S4's two additive changes. **AC-5 is already enforced** by `isSafeRepoPath` at `:58-66` and `:211` |
| `INTENT_EXTERNAL_FETCH_ENABLED` enforced **inside the getter**, default `false` | `platform/container.ts:148-157`, `config.ts:34` | `try { container.webFetch } catch { null }` — the exact shape at `intent/service.ts:124-130`. AC-33 falls out of it |
| `BlastResponse` with `state`/`indexed_sha`/`counts`/`map`/`prior_prs`; state-first degradation gates | `modules/blast/contract.ts:66-83`, `service.ts:54-96` | Read through the new container seam (R2). Note: blast returns `degraded` with `reason: 'no_changed_files'` when `pr_files` is empty (`service.ts:71-80`), so the brief's own zero-files 422 must precede it |
| `renderMapForPrompt` — deterministic map rendering, 12 symbols × 6 callers | `modules/blast/summary.ts:54-86` | Reused verbatim for the blast input (D-4) |
| `wrapUntrusted` (neutralises `</untrusted>`) + `INJECTION_GUARD` | `reviewer-core/src/prompt.ts:16-34` | Imported for fencing; `blast/summary.ts:49-50, 112` is the calling pattern. **Import only — reviewer-core is not modified** |
| `TiktokenTokenizer` / `approxTokens`, on the container | `adapters/tokenizer/index.ts:21-39`, `container.ts:134-138` | REQ-4's counter and its fallback. AC-8 is a `ContainerOverrides.tokenizer` injection |
| `completeStructured` → `{data, model, tokensIn, tokensOut, costUsd, raw, attempts}` with `maxTokens`/`timeoutMs`/`maxRetries` | `vendor/shared/adapters.ts:55-88` | The one call. `MockLLMProvider.calls` (`adapters/mocks.ts:90`) is how "zero model calls" is asserted; its fixture `safeParse` (`:92-95`) is how a stale fixture surfaces |
| Content-free observability contract + planted-secret test | `modules/reviews/prompt-log.ts:1-38`; `test/prompt-log.test.ts:8-16` | The template and the test shape for REQ-15 / AC-32 |
| `NotFoundError` 404 / `ValidationError` 422 / `ExternalServiceError` 502; global 120/min; per-route 5/min precedent | `platform/errors.ts:19-35`, `app.ts:95-97`, `intent/routes.ts:33-34`, `blast/routes.ts:52-55` | Verbatim |
| `PrDetail.linked_issue` resolved by regex over the PR body | `contracts/platform.ts:206-224`; `adapters/github/octokit.ts:126-131` | The fourth input — but fetched by the brief through `container.github()`, not read off `PrDetail` (see *Risks*) |
| Diff statistics and per-file counts | `db/schema/pulls.ts:22-24, 36-45` | The third input and the primary allow-list |
| `brief.json` with **zero readers** (`grep -rn 'useTranslations("brief")' client/src` → nothing) | `client/messages/en/brief.json:5, 8, 11` | Reuse `block.risks`, `noRisks`, `unavailable`. Rewrite `unavailableHint` (F-6). Leave `why.*`, `block.intent/blast/history`, `noHistory`, `overlap` unused |
| `Badge`, `EmptyState` (`cta`/`onCta`/`ctaLoading`), `Button` (`kind`, `loading`), `MonoLink` `onClick` variant rendering a real `<button>`, `Card`, `SectionLabel`, `Skeleton` | `client/src/vendor/ui/primitives/` | The whole card. `IntentCard.tsx:34-131` is the structural template: loading skeleton / empty + CTA / rendered + footer recompute |
| `formatCost` — distinguishes `null` → "—" from `0` → "$0.00" | `client/src/lib/cost.ts` (`client/INSIGHTS.md` 2026-06-14) | The cost display; never "$0.00" for absent |
| Local-envelope hook precedent | `client/src/lib/hooks/blast.ts:31-56`; paid call as a **mutation** at `:73-83` | R4 and S13 |
| `lineDomId`, and the `pendingJump` open-then-scroll effect | `components/diff-viewer/helpers.ts:18-20`, `FileCard.tsx:63-87` | The mechanism REQ-13 needs — currently gated on `findingLines` (`:162, 174-182`) |
| `?tab=findings&finding=…` + polling scroll, one history entry | `page.tsx:99-130` | The shape to mirror in the opposite direction (F-4) |
| Smart Diff Core/Wiring/Boilerplate ordering and per-file summaries | `smart-diff/routes.ts`, `SmartDiffViewer/constants.ts:9-34` | Untouched; the brief navigates **into** it |

---

## Steps

### S1 — Module-local contract for the brief envelope and the model's output shape
- **Files:** `server/src/modules/brief/contract.ts` (new)
- **Skill to apply:** `zod`, `typescript-expert`
- **Contents:** `ModelBrief` — the schema handed to `completeStructured`: `what`, `why`, `risk_level`, `risks[]`, `review_focus[{file, line?, reason}]`. `BriefFingerprint` with a **`local`** and a **`remote`** digest (BQ-1/A). `BriefProvenance`. `BriefResponse` covering §10's full field table: `state_fingerprint`, `inputs_used`, `references_used`, `references_skipped`, `discarded_refs`, `model`, `cost_usd`, `tokens_in`, `tokens_out`, `generated_at`, `out_of_date`, `moved_inputs`. Imports `Risk` / `RiskSeverity` from `@devdigest/shared`. Header comment states D-10 and points at `blast/contract.ts:1-26`.
- **Test:** `server/test/brief-contract.test.ts` (new) — parses a fixture of each shape; asserts `Risk` is imported rather than restated.
- **Depends on:** —
- **Done when:** `pnpm typecheck` passes, the file imports nothing from `vendor/shared` except `Risk`/`RiskSeverity`, and `diff -rq server/src/vendor/shared client/src/vendor/shared` still prints nothing.

### S2 — Widen the `pr_brief` schema (schema file only, no SQL)
- **Files:** `server/src/db/schema/reviews.ts` (edit `prBrief`)
- **Skill to apply:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Contents (BQ-4/A):** add `stateFingerprint text`, `provenance jsonb`, `model text`, `costUsd doublePrecision`, `tokensIn integer`, `tokensOut integer`, `generatedAt timestamptz`. The brief document itself **stays in `json`**. All new columns nullable or defaulted so the (empty) table migrates without a backfill.
- **Test:** `none — no behaviour change` (covered by S3's migrate and S11's integration round-trip)
- **Depends on:** S1
- **Done when:** `pnpm typecheck` passes and no new column is `.notNull()` without a default.

### S3 — Generate and apply the migration — **PROTECTED ZONE, its own step**
- **Files:** `server/src/db/migrations/00NN_*.sql` (**generated**), `server/src/db/migrations/meta/` (generated)
- **Skill to apply:** `drizzle-orm-patterns`
- **Commands:** `pnpm db:generate`, then `pnpm db:migrate`. **Never** hand-write or hand-edit the SQL; **never** fold into `0000_init.sql`; the server does **not** migrate on boot.
- **Test:** `none — verified by S11's integration suite, which migrates a testcontainer from scratch`
- **Depends on:** S2
- **Done when:** exactly one new `00NN_*.sql` exists containing only `ALTER TABLE "pr_brief" ADD COLUMN` statements, `git diff` shows `0000_init.sql` unchanged, and `pnpm db:migrate` applies cleanly.

### S4 — Extend the reference resolver: skip list out, whole-document drop in
- **Files:** `server/src/modules/intent/references.ts` (edit), `server/src/modules/intent/service.ts:133-157` (update the one caller)
- **Skill to apply:** `typescript-expert`, `security` (as a guardrail)
- **Contents:** **(BQ-3/A)** change `resolveReferences`' return to `{ resolved: ResolvedReference[], skipped: {source, reason}[] }`, surfacing the array that today reaches only the log line at `:198-201`. **(BQ-2/A)** add `dropWholeItems?: boolean` to `ResolveDeps`, **defaulting to `false`**; when `true`, an item that does not fit the remaining budget is dropped whole and recorded, instead of being sliced at `:185-192`. Update `intent/service.ts` to destructure `{ resolved }` and keep passing no flag, so intent's behaviour is byte-identical.
- **Test:** extend `server/test/intent-references.test.ts` — (a) intent's default path still truncates, byte-identical; (b) `dropWholeItems: true` drops whole and reports the source with a `(budget)` reason (**AC-11**); (c) `skipped` surfaces the flag-off case (`webFetch: null`) as a skip with a reason (feeds **AC-33**); (d) the existing traversal assertions at `:37-45` are **preserved unmodified** (**AC-5**).
- **Depends on:** S1
- **Done when:** `pnpm exec vitest run intent-references intent-classifier` is green, `intent.it.test.ts` passes unchanged, and `git diff` shows **no** change to `isSafeRepoPath` or to `fetchOne`'s repo-file branch.

### S5 — Container seam for the blast map
- **Files:** `server/src/platform/container.ts` (edit)
- **Skill to apply:** `typescript-expert`
- **Contents (R2):** add a **cached getter** `get blast(): BlastService`, alongside `repoIntel` and `tokenizer`. Comment must state why a getter is correct here and the `intent(logger)` method is not: `BlastService`'s constructor takes only the container (`blast/service.ts:31`) and holds no per-request logger, so `server/INSIGHTS.md` 2026-08-20's warning does not apply.
- **Test:** `none — no behaviour change` (exercised by S11)
- **Depends on:** —
- **Done when:** `pnpm typecheck` passes and `grep -rn "BlastService" server/src/modules/brief/` returns nothing.

### S6 — Grounding allow-list, the REQ-6 discard filter, and the REQ-7 cap
> **Ordering constraint, from the spec:** the allow-list must exist before the model output can be filtered. S6 lands before S11.
- **Files:** `server/src/modules/brief/grounding.ts` (new)
- **Skill to apply:** `typescript-expert`
- **Contents:** `buildAllowList(changedFiles, blast)` = changed paths ∪ `map.changed_symbols[].file` ∪ `map.downstream[].callers[].file` ∪ `downstream[].endpoints_affected` ∪ `crons_affected` ∪ `prior_prs[].overlapping_files`. `filterReferences` — **exact match only; no fuzzy matching, no repair, no substitution** — returning the surviving set and a discard count. `capRiskLevel` — lower only; no surviving risks → `low`; a risk whose own `severity` failed validation is excluded from the max so it can never raise the level (§10). Enforce that only **changed-file** paths may appear in `review_focus[].file` while `risks[].file_refs` may span the whole allow-list, and that reference-document **content contributes no allow-list entries** — a path named inside a spec is a claim, not an observation.
- **Test:** `server/test/brief-grounding.test.ts` (new) — AC-12, AC-13, AC-14, AC-15 (server half), AC-16, AC-17, plus the changed-file-only rule for `review_focus` and the "documents contribute no entries" rule.
- **Depends on:** S1, S5
- **Done when:** all six ACs are green and the module is pure — no container, no I/O, no import from `platform/`.

### S7 — The state fingerprint, split local / remote
> **Ordering constraint, from the spec:** the fingerprint must exist before the cache read means anything. S7 lands before S11.
- **Files:** `server/src/modules/brief/fingerprint.ts` (new)
- **Skill to apply:** `typescript-expert`
- **Contents (BQ-1/A):** a `sha256` over REQ-8's ten components, split into **`local`** — PR head sha, stored intent's `derived_at` + `model`, blast `indexed_sha` + `state`, resolved feature-model provider + model, and `ASSEMBLER_VERSION` — and **`remote`** — the linked issue's number, state and content digest, plus the source identifier and content digest of every resolved reference document. Only `local` is recomputable on the read path. `describeMoved(stored, current)` returns the human names of the differing **local** components for REQ-14's marker.
- **Test:** `server/test/brief-fingerprint.test.ts` (new) — **AC-20's five cases, each its own assertion**, proving the fingerprint moves for all five even though only four are read-detectable: intent re-derived, `indexed_sha` moved, linked-issue body edited *(moves `remote`)*, referenced document edited *(moves `remote`)*, `risk_brief` model changed. Plus **AC-19** (head moved → `local` differs). Plus stability (same inputs → same digest, key order irrelevant) and a leak guard (no component carries input **content**, only digests).
- **Depends on:** S1
- **Done when:** all five AC-20 cases and AC-19 produce a different digest, and the test explicitly records which two of the five move only the `remote` half.

### S8 — Input assembly, the header-only guarantee, and the 8 000-token budget
- **Files:** `server/src/modules/brief/assemble.ts` (new), `server/src/modules/brief/constants.ts` (new)
- **Skill to apply:** `typescript-expert`, `security`
- **Contents:** `constants.ts` holds the system prompt, `ASSEMBLER_VERSION`, `MAX_FILES_LISTED = 60`, `TOKEN_BUDGET = 8000`, `MAX_OUTPUT_TOKENS = 900`, `TIMEOUT_MS = 60_000`, `MAX_ISSUE_CHARS = 2000`, and D-8's drop order. `assemble.ts`: parse `pr_files.patch` for `@@` header ranges **only**, discarding every `+` / `-` / context line (REQ-3); render the blast map via `renderMapForPrompt`; fence every untrusted item with `wrapUntrusted` under its `source=` label; measure `container.tokenizer.count(system + user)`; drop **whole** items in the fixed order — resolved reference documents → linked issue → blast symbols beyond the highest-ranked → changed files beyond 60 — recording each drop **by source, never by content**. The system prompt states that `<untrusted>` content is data whose instructions are never followed.
- **Test:** `server/test/brief-assemble.test.ts` (new) — **AC-6** (sentinel `+const SENTINEL_DO_NOT_SEND = 1;` absent from the captured input; that file's path **and** its `@@` range present), **AC-7**, **AC-8** (injected failing tokenizer → `ceil(chars/4)`, assembly completes), **AC-10**; plus the drop order and "no item appears partially".
- **Depends on:** S1, S4, S6
- **Done when:** all four ACs are green and a grep of the produced user message for any `+`- or `-`-prefixed source line finds nothing.

### S9 — Content-free provenance record
- **Files:** `server/src/modules/brief/provenance.ts` (new)
- **Skill to apply:** `security`, `typescript-expert`
- **Contents:** header restates the safety contract from `reviews/prompt-log.ts:6-21` verbatim in spirit — values are numbers, fixed source labels, repository paths, and truncated digests; **never** issue or document prose; there is no verbosity level that turns content on. Records `inputs_used`, `references_used` / `references_skipped` (source + reason), the estimated input tokens, `tokensIn` / `tokensOut`, `costUsd`, `discarded_refs`, the dropped-item list, and the resolved model.
- **Test:** `server/test/brief-provenance.test.ts` (new) — **AC-32** (three planted secrets in the PR body, the linked issue and a referenced document; **none** appears in the record; every named field present), **AC-33** (an `https://` reference with the flag at its default `false` → no outbound fetch, recorded as skipped, assembly completes). Copy the planted-secret shape from `test/prompt-log.test.ts:8-16`.
- **Depends on:** S1, S4, S8
- **Done when:** the leak assertions pass and no code path stringifies a `ResolvedReference.content`.

### S10 — `pr_brief` repository
- **Files:** `server/src/modules/brief/repository.ts` (new)
- **Skill to apply:** `drizzle-orm-patterns`
- **Contents:** `getBrief(prId)` and `upsertBrief(prId, …)` with `onConflictDoUpdate` on `pr_id` (last write wins — §6 Concurrency). Takes an **already-scoped** `prId`; performs no workspace-less lookup of its own.
- **Test:** `none — no behaviour change; round-tripped by S11's integration suite`
- **Depends on:** S3
- **Done when:** `pnpm typecheck` passes and the repository exposes no method that accepts a bare id without a caller-side ownership check.

### S11 — The brief service
- **Files:** `server/src/modules/brief/service.ts` (new)
- **Skill to apply:** `fastify-best-practices`, `typescript-expert`, `security`
- **Contents:** **Read path** — verify PR ownership **before** touching `pr_brief` (`pr_brief` has no `workspace_id`; mirror `intent/service.ts:69-75`); read the stored brief; recompute the **local** fingerprint only (BQ-1/A); mark out of date and name the moved local inputs; make **no** model call and **no** outbound call. **Assemble path** — refuse 422 when `pr_files` is empty; read intent via `container.intent(log).get` (**never** `getOrCompute`, D-12); read the blast map via `container.blast`, treating any error as `degraded`; refuse 422 naming **both** when intent is absent **and** blast is degraded (REQ-11); resolve PR-body references best-effort with `dropWholeItems: true`, each fetch individually wrapped so one failure never affects the others; resolve `risk_brief`; issue **exactly one** `completeStructured` with `maxTokens: 900`, `timeoutMs: 60_000`; filter and cap via S6; store via S10 with both fingerprint halves and the provenance; on model failure return 502 **without** replacing the stored brief.
- **Test:** `server/test/brief.it.test.ts` (new, testcontainers, **`NODE_ENV=development` config per R3**, following `intent.it.test.ts:20-21`) — AC-1, AC-2, AC-3, AC-4, AC-9, AC-18, AC-19, AC-20 (end-to-end), AC-21, AC-23, AC-25, AC-26, AC-31 (server half).
- **Depends on:** S4, S5, S6, S7, S8, S9, S10
- **Done when:** every listed AC is green and `grep -rn "getOrCompute\|NODE_ENV\|nodeEnv" server/src/modules/brief/` returns nothing.

### S12 — Routes and registry
- **Files:** `server/src/modules/brief/routes.ts` (new), `server/src/modules/index.ts` (**+1 import, +1 entry**)
- **Skill to apply:** `fastify-best-practices`, `zod`
- **Contents:** `GET /pulls/:id/brief` — cache-only, **no** rate-limit override (§7: the read is model-free by REQ-9 and needs nothing beyond the global 120/min), returning an explicit no-brief outcome rather than a 404 when none is stored. `POST /pulls/:id/brief` — `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }`, body `{ regenerate?: boolean }`. Both use `withTypeProvider<ZodTypeProvider>()`, `IdParams` and `getContext`.
- **Test:** extend `server/test/brief.it.test.ts` — **write the AC-24 assertion first** (see *Risks*): six POSTs inside one minute, the sixth rejected by the limiter, on the **development-config** app. Then AC-22, and a 404 for a PR in another workspace raised **before** any `pr_brief` read. Also extend `server/test/routes-smoke.test.ts` with the two new routes.
- **Depends on:** S11
- **Done when:** both ACs are green, `modules/index.ts` shows exactly two added lines, and the smoke test lists both routes.

### S13 — Client hook and local response type
- **Files:** `client/src/lib/hooks/brief.ts` (new)
- **Skill to apply:** `react-best-practices`
- **Contents (R4):** the response envelope declared **locally**, with a header comment citing `hooks/blast.ts:31-56`; `Risk` imported from `@devdigest/shared`. `usePrBrief(prId)` as a `useQuery`. `useGenerateBrief(prId)` as a **`useMutation`** — it costs a model call, so it must never fire from a render or a refetch, exactly as `useBlastSummary` documents at `hooks/blast.ts:73-79` — invalidating `["brief", prId]` on success.
- **Test:** `none — types and wiring only; exercised by S15`
- **Depends on:** S1 (shape only — does **not** require the server route to be running)
- **Done when:** `pnpm typecheck` passes and `git diff client/src/lib/types.ts` is empty.

### S14 — i18n keys
- **Files:** `client/messages/en/brief.json` (edit)
- **Skill to apply:** — (mechanical)
- **Contents:** add `title` ("Why & Risk"), `what`, `why`, `riskLevel`, `riskLevel.high|medium|low`, `reviewFocus`, `noFocus`, `generate`, `regenerate`, `outOfDate`, `outOfDate.moved`, `fileCapped`, `impactUnknown`, `partialCaveat`, `notInDiff`, `loadFailed`. **Rewrite `unavailableHint`** to F-6's exact string: *"Generate a brief to see what this PR changes, why, and what to review first."* Leave `why.*`, `block.intent`, `block.blast`, `block.history`, `noHistory` and `overlap` untouched and unused.
- **Test:** `none — no behaviour change; every added key is asserted in use by S15`
- **Depends on:** —
- **Done when:** the file parses, `unavailableHint` reads exactly F-6's string, and `grep -rn 'brief.why\.' client/src` returns nothing.

### S15 — The Why & Risk card
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyRiskCard/{WhyRiskCard.tsx, constants.ts, styles.ts, index.ts, WhyRiskCard.test.tsx}` (all new)
- **Skill to apply:** `react-best-practices`, `react-testing-library` (**with the `fireEvent` override**)
- **Contents:** structure mirrors `IntentCard.tsx:34-131` — loading skeleton / empty state (`EmptyState` with `brief.unavailable`, the rewritten hint, and a generate CTA) / rendered. **`constants.ts` holds `RISK_META: Record<RiskSeverity, {color, bg, icon: IconName, labelKey}>` per R1**, mirroring `IntentCard/constants.ts:10-32`; the risk level renders through **`Badge`** as a word plus an icon — **never `SeverityBadge`**, whose union will not accept a `RiskSeverity`. Risks: ≤ 6, `brief.noRisks` when empty, `file_refs` as `MonoLink` `onClick`. Review focus: ≤ 8, `MonoLink` `onClick` (a real `<button>`, Enter/Space, reading order, announcing file + line + reason), reference first and reason after an em dash, the reason wrapping **below** the reference on a narrow viewport, long paths middle-truncated with the full path on hover. Footer: model, `formatCost`, `tokens_in → tokens_out` with `tnum`, a regenerate `Button` with `loading`, and the out-of-date marker naming the moved local input. `styles.ts` uses `satisfies CSSProperties` and CSS custom properties — **no Tailwind**.
- **Test:** `WhyRiskCard.test.tsx` — **AC-27** (label "Why & Risk"; the risk level asserted **by its word**, not its colour; what/why/risks/focus all render), **AC-28**'s card half (empty state + generate control, and the mutation **not** called on mount), **AC-15**'s client half (all focus references discarded → empty-focus state, **no** changed file substituted), **AC-30** (a focus entry with no line → handler called without a line, no throw), **AC-31**'s client half (out-of-date marker naming the moved input, content still readable, regenerate offered), plus the read-failure error state (§6). Use `fireEvent`.
- **Depends on:** S13, S14, S17
- **Done when:** every listed AC is green, and `grep -rn "SeverityBadge" WhyRiskCard/` and a Tailwind-class grep both return nothing.

### S16 — Mount the card on the Overview tab
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (edit), `.../OverviewTab/styles.ts` (edit if a section style is needed)
- **Skill to apply:** `react-best-practices`, `next-best-practices`
- **Contents:** render `WhyRiskCard` **above** `IntentCard` (F-1 places it where the design puts its own top block). The card takes `prId` and an `onOpenFile(path, line?)` prop threaded from `page.tsx`. `IntentCard` and `BlastCard` are **not** modified and must never be blocked by the brief's loading state (§6 Loading).
- **Test:** extend `WhyRiskCard.test.tsx` (or add `OverviewTab.test.tsx`) — the card renders above `IntentCard`, and a failing brief query leaves both other cards rendered.
- **Depends on:** S15, S17
- **Done when:** the tab renders all three cards and `git diff` shows no change inside `IntentCard/` or `BlastCard/`.

### S17 — Files-changed entry point at `file:line`
- **Files:** `client/src/components/diff-viewer/FileCard/FileCard.tsx` (edit), `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx` (edit — pass through), `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx` (edit — pass through), `.../_components/DiffTab/DiffTab.tsx` (edit — new `focus` prop), `.../page.tsx` (edit)
- **Skill to apply:** `react-best-practices`, `react-testing-library`
- **Contents:** `FileCard` gains `focus?: { line?: number }`. When set: force the card open, render `id={lineDomId(path, newNo)}` on the **targeted** line **in addition to** flagged lines — today that id is emitted only inside the flagged branch at `:174-182` — and drive the existing `pendingJump` effect at `:72-80`. `page.tsx` mirrors `?tab=findings&finding=…` (`:99-130`) in the opposite direction: `onOpenFile` does **one** `router.push` setting `tab=diff` plus `file` and `line` together so it costs one history entry, and a polling effect clears the params once consumed. **`diff-viewer` must not learn that an Overview tab exists** — it receives a value, never a route; the constraint is stated in its own comment at `FileCard.tsx:51-55`.
- **Test:** `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` (new) — focus opens a collapsed card; `scrollIntoView` is called (**stub `Element.prototype.scrollIntoView = vi.fn()`** per `SmartDiffViewer.test.tsx:13`) — this is **AC-29's scroll half** per BQ-5/A; the targeted line carries the `lineDomId` id; **AC-30**'s no-line case neither scrolls nor throws; a file not in the returned diff opens the tab with no target (§6 Navigation / F-4); and — the **regression guard** — an unfocused, unflagged line still renders with no wrapper div, byte-identical to today (`FileCard.tsx:171-173`). `SmartDiffViewer.test.tsx` must stay green **untouched**.
- **Depends on:** S14
- **Done when:** the new tests and the existing `SmartDiffViewer.test.tsx` are both green, and `grep -rn "tab=\|router\|useSearchParams" client/src/components/diff-viewer/` returns nothing.

### S18 — Seed a stored brief and a patch for `src/config.ts`
- **Files:** `server/src/db/seed.ts` (edit)
- **Skill to apply:** `drizzle-orm-patterns`
- **Contents (BQ-5/A):** insert one `pr_brief` row for PR #482 whose first review-focus entry is `src/config.ts:12` — matching F-2/F-3 and the seeded finding at `seed.ts:151-159` — with a `state_fingerprint` that **matches** the seeded PR state so the e2e read is a clean cache hit. Also add a `patch` to the seeded `src/config.ts` row (`seed.ts:123`) containing a hunk whose new-side numbering covers line 12. Today **all four** seeded `pr_files` rows have `patch: null`, which is why `FileCard` renders `diffViewer.noDiffText` and why AC-29 was unverifiable.
- **Test:** `none — fixture data; asserted by S19`
- **Depends on:** S1, S3
- **Done when:** `pnpm db:seed` on a fresh DB yields a PR #482 whose Overview shows a populated card and whose Files changed tab renders real diff lines for `src/config.ts`.

### S19 — e2e flow `09-pr-brief`
- **Files:** `e2e/specs/09-pr-brief.flow.json` (new), `e2e/README.md` (coverage table +1 row)
- **Skill to apply:** — (JSON flow; `e2e/CLAUDE.md` determinism rule)
- **Contents:** open PR #482 → Overview → `wait --text "Why & Risk"` plus the seeded `what` text (**AC-27**); assert the empty-state path for a PR with no brief (**AC-28**); `find text "src/config.ts:12" click` → `wait --url "tab=diff"` → `wait --text` on a line rendered from the seeded patch (**AC-29's navigation half**, per BQ-5/A). The flow **never presses generate** — that is how **AC-34** is satisfied structurally rather than by any environment guard. Assertions are `wait --url` / `wait --text` / `find role|text|label` only; `09` is confirmed free on disk.
- **Test:** the flow **is** the test: `./scripts/e2e.sh`
- **Depends on:** S12, S16, S17, S18
- **Done when:** the flow passes hermetically and no `POST /pulls/:id/brief` appears in the API log for the run.

### S20 — Record findings
- **Files:** `server/INSIGHTS.md` (**append only**), `client/INSIGHTS.md` (**append only**)
- **Skill to apply:** `engineering-insights`
- **Contents (R5):** server — the resolver's truncate-vs-drop divergence (`references.ts:185-192` vs. D-8/AC-11) and its opt-in resolution; and `pr_brief` as the **sixth** confirmed part-0 zero-writer scaffolding instance. Client — `SeverityBadge` cannot take a `RiskSeverity` because `SEV` is keyed `CRITICAL|WARNING|SUGGESTION|INFO`. Re-read each file first; do not duplicate an existing entry.
- **Test:** `none — documentation`
- **Depends on:** S19
- **Done when:** both files have entries appended under the right headings and `git diff` shows **no deleted lines** in either.

---

## Contract & DB changes

**Contract — `server/src/modules/brief/contract.ts` (S1).** Module-local per D-10. **`server/src/vendor/shared/` is NOT entered**, and therefore neither is the mirrored client copy. `PrBrief` at `contracts/brief.ts:143-149` is **not** extended and stays dead scaffolding — the stated consequence of D-10, not an oversight. The only shared imports are `Risk` and `RiskSeverity` (`contracts/brief.ts:74-89`), used verbatim.

The two-copy byte-identity invariant remains a gate row even though no step enters it. Verified clean at plan time (`diff -rq server/src/vendor/shared client/src/vendor/shared` → no output; the copies drifted undetected once, per `server/INSIGHTS.md` 2026-08-17). **If an implementer finds itself editing either tree, it has left the plan: stop and re-open D-10.**

**DB — `pr_brief` (S2 → S3).** Protected zone, split across two steps on purpose.

1. **S2** edits `server/src/db/schema/reviews.ts` only: `+stateFingerprint text`, `+provenance jsonb`, `+model text`, `+costUsd doublePrecision`, `+tokensIn integer`, `+tokensOut integer`, `+generatedAt timestamptz`. All nullable or defaulted. The brief document stays in the existing `json` column (BQ-4/A).
2. **S3** runs `pnpm db:generate`, producing a **new** `00NN_*.sql` after `0012_tidy_firebrand.sql`, then `pnpm db:migrate`. The SQL is never hand-written; `0000_init.sql` — which created `pr_brief` at `:211` — is never touched. The server does **not** migrate on boot.

Both commands will hit a permission prompt.

---

## Verification

There is **no linter in this repository** — no ESLint, Biome or Prettier config and no `lint` script in any package. Do not plan or run one. The gates are typecheck and tests.

| Package | Command | Gate | Stage |
|---|---|---|---|
| server | `pnpm typecheck` | must pass. **Does not cover `test/`** (`tsconfig` `include: ["src/**/*.ts"]`, `server/INSIGHTS.md` 2026-08-17) — a green typecheck is not evidence the suites pass | implementer (per diff) |
| server | `pnpm exec vitest related <changed files>` | must pass | implementer (per diff) |
| server | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | full unit suite green | plan-verifier |
| server | `pnpm exec vitest run .it.test` | integration green. Needs Docker; under OrbStack `export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` or the files **fail rather than skip** | plan-verifier |
| server | `pnpm db:migrate` on a clean DB | the new migration applies; `git diff` shows `0000_init.sql` unchanged | implementer (S3 only) |
| both | `diff -rq server/src/vendor/shared client/src/vendor/shared` | prints nothing | plan-verifier |
| client | `pnpm typecheck` | must pass. **Does** cover `.test.tsx` | implementer (per diff) |
| client | `pnpm exec vitest related <changed files>` | must pass | implementer (per diff) |
| client | `pnpm test` | full suite green, including `SmartDiffViewer.test.tsx` **unmodified** | plan-verifier |
| e2e | `./scripts/e2e.sh` | **optional** — hermetic stack; flows `01`–`09` pass and no LLM call is made | plan-verifier |
| reviewer-core | — | **not touched** (D-3); no row | — |

**Test staging.** Each `implementer` runs `pnpm typecheck` plus `vitest related` on its own diff during its track, and the full package suite **once** at the end of that track as a track-local smoke. `plan-verifier` re-runs the table above **once** as the gate. No suite is paid for twice by two different stages.

**Permissions.** `.claude/settings.local.json` allows only three git commands, and the single project hook guards writes under `specs/`. Expect prompts for `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`, `docker compose` and `./scripts/e2e.sh`. A prompt is not a failure — do not let it stall a track.

### Acceptance criteria carried from the spec

| AC | From spec | Verified by | Covered by step |
|---|---|---|---|
| AC-1 | REQ-1 — read returns non-empty `what`/`why`, valid `risk_level`, `risks`, `review_focus` | integration | S11 (`brief.it.test.ts`) |
| AC-2 | REQ-2 — exactly one structured completion per assembly | integration | S11 (`brief.it.test.ts`, `MockLLMProvider.calls`) |
| AC-3 | REQ-2 — stale intent read as-is; no derivation call | integration | S11 (`brief.it.test.ts`) |
| AC-4 | REQ-2 — `docs/` plan + `#123` in the input; five sources recorded | integration | S8 + S11 (`brief.it.test.ts`) |
| AC-5 | REQ-2 — traversal / absolute / NUL path rejected, never opened | unit | S4 (`intent-references.test.ts`, existing assertions preserved) |
| AC-6 | REQ-3 — sentinel absent; path + `@@` range present | unit | S8 (`brief-assemble.test.ts`) |
| AC-7 | REQ-4 — estimate == `cl100k_base(system+user)`, ≤ 8 000 | unit | S8 (`brief-assemble.test.ts`) |
| AC-8 | REQ-4 — encoder failure → `ceil(chars/4)`, assembly completes | unit | S8 (`brief-assemble.test.ts`, injected tokenizer) |
| AC-9 | REQ-5 — over-budget → ≤ 8 000, nothing partial, drops recorded, succeeds | integration | S8 + S11 (`brief.it.test.ts`) |
| AC-10 | REQ-5 — 300 files → ≤ 60 entries, omission recorded | unit | S8 (`brief-assemble.test.ts`) |
| AC-11 | REQ-5 — whole documents dropped in the shipped order, recorded by source | unit | S4 (`intent-references.test.ts`, `dropWholeItems: true`) |
| AC-12 | REQ-6 — nonexistent path discarded; discard count 1 | unit | S6 (`brief-grounding.test.ts`) |
| AC-13 | REQ-6 — near match discarded, **not** corrected | unit | S6 (`brief-grounding.test.ts`) |
| AC-14 | REQ-6 — blast caller file absent from the diff survives | unit | S6 (`brief-grounding.test.ts`) |
| AC-15 | REQ-6 — all discarded → empty focus state, no substitution | unit + unit (client) | S6 (`brief-grounding.test.ts`) + S15 (`WhyRiskCard.test.tsx`) |
| AC-16 | REQ-7 — `high` capped to `low` | unit | S6 (`brief-grounding.test.ts`) |
| AC-17 | REQ-7 — `low` stays `low`; the rule only lowers | unit | S6 (`brief-grounding.test.ts`) |
| AC-18 | REQ-8, REQ-9 — unchanged inputs → stored brief, zero further calls | integration | S7 + S11 (`brief.it.test.ts`) |
| AC-19 | REQ-8 — head moves → fingerprint differs, reads out of date | integration | S7 (`brief-fingerprint.test.ts`) + S11 (`brief.it.test.ts`) |
| AC-20 | REQ-8 — five unchanged-head cases each move the fingerprint | integration | S7 (`brief-fingerprint.test.ts`, five assertions; two move the `remote` half only) + S11 (`brief.it.test.ts`) |
| AC-21 | REQ-9 — read → zero model calls, **no `NODE_ENV` guard in the path** | integration | S11 + S12 (`brief.it.test.ts`) |
| AC-22 | REQ-9 — no stored brief → explicit no-brief outcome, no assembly started | integration | S12 (`brief.it.test.ts`) |
| AC-23 | REQ-10 — regenerate on a matching fingerprint calls the model and replaces | integration | S11 (`brief.it.test.ts`) |
| AC-24 | REQ-10 — sixth request in one minute rejected | integration | S12 (`brief.it.test.ts`, **development-config app per R3**; written first) |
| AC-25 | REQ-11 — no intent + degraded map → 422 naming both, no model call | integration | S11 (`brief.it.test.ts`) |
| AC-26 | REQ-11 — no intent + `ok` map → brief produced, intent omitted from sources | integration | S11 (`brief.it.test.ts`) |
| AC-27 | REQ-12 — "Why & Risk" renders; level as a word; all four sections | unit (client) + e2e flow | S15 (`WhyRiskCard.test.tsx`) + S19 (`09-pr-brief.flow.json`) |
| AC-28 | REQ-12 — no brief → "Brief not available yet." + generate, no model call | e2e flow | S19 (+ S15's empty-state assertion) |
| AC-29 | REQ-13 — focus entry → Files changed, file expanded, line 12 in view | e2e flow **(split per BQ-5/A)** | S17 (`FileCard.test.tsx` — scroll + DOM id) + S18 (seeded patch) + S19 (navigation) |
| AC-30 | REQ-13 — entry with no line → tab opens, file expanded, no scroll, no error | unit (client) | S17 (`FileCard.test.tsx`) + S15 (`WhyRiskCard.test.tsx`) |
| AC-31 | REQ-14 — out-of-date marker names the moved input; content readable; regenerate offered | unit (client) + integration | S15 (`WhyRiskCard.test.tsx`) + S11 (`brief.it.test.ts`) |
| AC-32 | REQ-15 — three planted secrets absent; every provenance field present | unit | S9 (`brief-provenance.test.ts`) |
| AC-33 | Inherited (`INTENT_EXTERNAL_FETCH_ENABLED`) — no fetch, recorded as skipped, completes | unit | S9 + S4 (`brief-provenance.test.ts`) |
| AC-34 | REQ-9, REQ-2 — the whole flow makes no LLM call, by never pressing generate | e2e flow | S19 (`09-pr-brief.flow.json`) |

**All 34 carried, none conditional.** The three that were conditional at draft (AC-11, AC-24, AC-29) are settled by BQ-2/A, R3 and BQ-5/A respectively.

---

## Execution — MULTI-AGENT RUN (agreed mode)

**This is the agreed decomposition. 13 agent invocations.**

| Track | Steps | Agent | Model | File set | Starts after | Brief |
|---|---|---|---|---|---|---|
| **T0** *(barrier)* | S1, S2, S3 | `implementer` | **opus** | `server/src/modules/brief/contract.ts`, `server/src/db/schema/reviews.ts`, `server/src/db/migrations/00NN_*.sql` + `meta/`, `server/test/brief-contract.test.ts` | — | Define the module-local brief envelope, reusing shared `Risk`/`RiskSeverity`, with the fingerprint split into a `local` and a `remote` digest. Widen `pr_brief` with fingerprint/provenance/cost columns; the brief document stays in `json`. Do **not** enter `vendor/shared` (D-10) — `PrBrief` stays dead scaffolding. Run `pnpm db:generate` then `pnpm db:migrate`; never hand-write SQL; never touch `0000_init.sql`. |
| **T1** | S4, S5 | `implementer` | **opus** | `server/src/modules/intent/references.ts`, `server/src/modules/intent/service.ts`, `server/src/platform/container.ts`, `server/test/intent-references.test.ts` | T0 | Two additive changes to the shipped resolver: return `{resolved, skipped}` so skips carry a reason, and add `dropWholeItems?: boolean` defaulting to **false** so intent's behaviour stays byte-identical. Do **not** weaken `isSafeRepoPath` or the `fetchOne` re-check — they are the security posture D-13 reuses wholesale. Add a **cached** `blast` getter to the container (the method-not-getter rule does not apply: `BlastService` takes no logger). `intent.it.test.ts` must pass unchanged. |
| **T2** | S6, S7, S8, S9 | `implementer` | **opus** | `server/src/modules/brief/{grounding,fingerprint,assemble,provenance,constants}.ts`, `server/test/brief-{grounding,fingerprint,assemble,provenance}.test.ts` | T1 | Four pure modules — no I/O, no container, no `platform/` imports. Allow-list + exact-match discard (no fuzzy, no repair) + lower-only risk cap; a split local/remote fingerprint over REQ-8's ten components; hunk-header-only assembly under 8 000 `cl100k_base` tokens with whole-item drops in D-8's order; a provenance record carrying **no input content** — copy the safety contract from `reviews/prompt-log.ts:6-21`. **15 of the 34 ACs ride on this track.** |
| **T3** | S10, S11, S12 | `implementer` | **opus** | `server/src/modules/brief/{repository,service,routes}.ts`, `server/src/modules/index.ts`, `server/test/brief.it.test.ts`, `server/test/routes-smoke.test.ts` | T2 | Wire the four pure modules into a service and two routes. **Verify PR ownership before the `pr_brief` read** — the table has no `workspace_id` and a cache hit that skipped the check serves another tenant's brief. `container.intent(log).get` only, never `getOrCompute`. One `completeStructured`, `maxTokens: 900`, `timeoutMs: 60_000`. Refuse 422 when `pr_files` is empty, and when intent is absent **and** blast is degraded. **This track owns `modules/index.ts`** (+1 import, +1 entry). Build the integration app on `NODE_ENV=development` or the 5/min limiter is inert; **write the AC-24 assertion first**. |
| **T4** | S13, S14 | `implementer` | **sonnet** | `client/src/lib/hooks/brief.ts`, `client/messages/en/brief.json` | T0 | Mechanical. Declare the response envelope **locally** in the hook file (follow `hooks/blast.ts:31-56`), import `Risk` from shared, and make generate a **mutation**, never a query — it costs money. Add the new keys and rewrite `unavailableHint` to exactly: "Generate a brief to see what this PR changes, why, and what to review first." Do **not** touch `lib/types.ts`, `lib/feature-models.ts`, or any `why.*` key — that block is per-line git blame, a different feature sharing the word. |
| **T5** | S15, S16 | `implementer` | **sonnet** | `client/src/app/.../_components/WhyRiskCard/*` (new), `.../_components/OverviewTab/{OverviewTab.tsx,styles.ts}` | T4, T6 | Build the card on existing primitives, following `IntentCard.tsx:34-131`. Render the risk level via **`Badge` + a local `RISK_META`** — `SeverityBadge` takes `CRITICAL\|WARNING\|SUGGESTION\|INFO` and **will not compile** against `RiskSeverity`. Colocated `styles.ts` with `satisfies CSSProperties`; **no Tailwind**. Tests use `fireEvent` — `user-event` is not installed. Mount above `IntentCard`; change neither `IntentCard` nor `BlastCard`, and never block them on the brief's loading state. |
| **T6** | S17 | `implementer` | **opus** | `client/src/components/diff-viewer/{FileCard/FileCard.tsx, FileCard/FileCard.test.tsx, DiffViewer/DiffViewer.tsx}`, `.../_components/{SmartDiffViewer,DiffTab}/*.tsx`, `.../page.tsx` | T4 | Add a `focus` prop so a file opens at a line. Today `lineDomId` is emitted **only** on lines already in `findingLines` (`FileCard.tsx:162, 174-182`) — extend that branch, do not replace it, and keep an unfocused unflagged line wrapper-free so files with no findings stay byte-identical. `diff-viewer` is cross-route and must not learn that tabs exist. Mirror `page.tsx:99-130` in the opposite direction, one history entry. `SmartDiffViewer.test.tsx` must stay green **untouched** — a regression here hits every diff view in the app. |
| **T7** | S18, S19 | `implementer` | **sonnet** | `server/src/db/seed.ts`, `e2e/specs/09-pr-brief.flow.json`, `e2e/README.md` | T3, T5, T6 | Seed one `pr_brief` row for PR #482 with `src/config.ts:12` first in review focus and a fingerprint matching the seeded state, plus a `patch` for the seeded `src/config.ts` row — all four rows are `patch: null` today, which is why line 12 does not exist in the DOM. Write flow `09` that **never presses generate**; that is how AC-34 is satisfied. Assertions are `wait --url` / `wait --text` / `find role\|text\|label` only. |
| **T8** | S20 | `doc-writer` | **sonnet** | `server/INSIGHTS.md`, `client/INSIGHTS.md` | T7 | Append-only. Re-read each file first and do not duplicate. Record the resolver truncate-vs-drop divergence and its opt-in resolution; `pr_brief` as the sixth zero-writer scaffolding instance; and `SeverityBadge`'s union mismatch. |
| **R1** | — | `plan-verifier` | opus | read-only | T8 | Re-run the verification table once. Check all 34 ACs against this plan and the landed diff. |
| **R2** | — | `architecture-reviewer` | opus | read-only | T8 | Grade the settled diff against D-10 (no `vendor/shared`), D-12 (no `getOrCompute`), D-14 (no lazy assembly, no `NODE_ENV` guard), tenancy-before-cache, and exactly one model call. |

**Barriers:**

1. **T0 is a global barrier.** The contract shape and the migration land before T1–T4 start. `diff -rq server/src/vendor/shared client/src/vendor/shared` must print nothing at the barrier.
2. **DB is serial and indivisible:** schema edit → `db:generate` → `db:migrate`, all inside T0, never split.
3. **`server/src/modules/index.ts` is assigned to T3 alone.** No other track edits it.
4. **The server lane T0 → T1 → T2 → T3 is a strict chain** — T2 consumes T1's resolver return shape; T3 consumes T2's four modules.
5. **`client/.../page.tsx` is assigned to T6 alone.** T5 receives `onOpenFile` as a prop and does not route.
6. **Reviewers grade a settled diff.** R1 and R2 start after T8, never alongside any writing track.
7. **`test-writer` is not invoked.** Coverage rides on each step's named `Test:` line, written by that track's own implementer.

**Real parallelism:** two lanes. The server lane (T1 → T2 → T3) and the client lane (T4 → {T6 → T5}) run concurrently after the T0 barrier and meet at T7. Within each lane the steps are serial by dependency, not by policy.

**Worktree isolation needed: yes** — between the server lane and the client lane, and between T5 and T6 if you choose to run them concurrently. Without isolation, order T6 before T5 so the `onOpenFile` prop exists before the card consumes it. T7 must not start early: it writes `server/src/db/seed.ts` while the server lane may still be active.

---

## Execution — single-agent pass *(recorded alternative, not the agreed mode)*

Retained so a later reader can see what was traded away. One `implementer` on `opus`, strictly in order:

S1 → S2 → S3 *(`db:generate`, `db:migrate`; confirm `0000_init.sql` unchanged)* → S4 *(`vitest run intent-references`)* → S5 → S6 *(`vitest run brief-grounding`)* → S7 *(`vitest run brief-fingerprint`)* → S8 *(`vitest run brief-assemble`)* → S9 *(`vitest run brief-provenance`)* → S10 → S11 *(`vitest run brief.it.test` — Docker required)* → S12 *(`vitest run routes-smoke brief.it.test`)* → server typecheck + full server suite once → S13 → S14 → S17 *(`vitest related FileCard SmartDiffViewer`)* → S15 *(`vitest related WhyRiskCard`)* → S16 → client typecheck + full client suite once → S18 → S19 *(`./scripts/e2e.sh`)* → S20. Then `plan-verifier`, then `architecture-reviewer`.

**Why it was not chosen:** the client lane (T4–T6: 5 steps, 7 files, its own suite) shares **zero** files with the server lane and depends on it only through the contract shape that T0 pins, so serialising them buys nothing; and 20 steps across two packages is far past the ≤ 4-step threshold at which a single pass wins. Its honest cost is serial wall-clock — the server chain S1→S12 is serial in either mode, so the single pass forfeits only the client lane and the pipelined review gate, roughly a third of elapsed time.

---

## Cost envelope

Fix rounds budgeted at two. `/impl` reads this as the default for its `--max-agents` ceiling, so both numbers were counted, not estimated.

| Mode | Agent invocations | Model tiers | What dominates the cost |
|---|---|---|---|
| **multi-agent (agreed)** | **13** — 8 `implementer` tracks (T0–T7) + 1 `doc-writer` (T8) + 2 fix rounds + 1 `plan-verifier` + 1 `architecture-reviewer` | opus ×5 (T0, T1, T2, T3, T6) · sonnet ×4 (T4, T5, T7, T8) · opus ×2 reviewers · fix rounds inherit the failing track's tier | Per-track briefs keep each context small — that is the whole saving, since a track that re-read this plan, both `CLAUDE.md` files and every `INSIGHTS.md` would multiply that context eight times over. Four sonnet tracks absorb the mechanical work (hook, i18n, card, seed, flow, insights). The cost floor is T2 and T3, which carry 27 of the 34 ACs between them |
| single-agent (alternative) | **6** — 1 `implementer` (all 20 steps) + 2 fix rounds + 1 `doc-writer` + 1 `plan-verifier` + 1 `architecture-reviewer` | opus ×6 | One very long opus context carrying all 20 steps, the 622-line spec, both `CLAUDE.md` files and three `INSIGHTS.md` for the whole run. Low invocation count, high per-invocation context |

**Set `/impl --max-agents 13`.**

---

## Risks & open questions

- **What BQ-1/A gives up, stated plainly.** An **edited linked issue** and an **edited referenced repository document** move the `remote` half of the fingerprint, so they are detected at the **next generate**, not at the next open. Four of AC-20's five cases (head moved, intent re-derived, `indexed_sha` moved, `risk_brief` model changed) are read-detectable; the other two are not. All five still move the fingerprint, asserted directly against the fingerprint function in `brief-fingerprint.test.ts`. This is the accepted cost of keeping the Overview read DB-only and inside §7's 300 ms budget.
- **AC-24 is new ground.** `grep -rn "429" server/test` returns nothing — no test in this repository asserts a rate-limit rejection, and the two existing 5/min overrides (`intent/routes.ts:33`, `blast/routes.ts:54`) have **never been exercised by a test**. S12 may surface an unknown about `@fastify/rate-limit`'s per-route store keying under `app.inject()`. **Write the AC-24 assertion first**, before the rest of S12, so the unknown surfaces while the route is still cheap to reshape.
- **The `pr_brief` fingerprint has no `workspace_id`.** Tenancy scopes only through `pr_id`, which is why S11 verifies ownership **before** the cache read and S12 asserts a 404 raised before any `pr_brief` access. A future writer that skips it serves another tenant's brief on a cache hit while a cache miss correctly 404s — making the guard depend on whether a row happened to be cached. This is the exact bug `intent/service.ts:69-75` documents, and its comment already names `pr_brief`.
- **Unverified — `linked_issue` on the offline fallback path.** `PrDetail.linked_issue` is set only on the GitHub-refresh branch (`pulls/routes.ts:303`); the offline fallback at `:307-338` omits it. If the brief read `linked_issue` off `PrDetail` rather than fetching it, an offline assembly would silently drop the fourth input. **§9 says the brief reaches GitHub via `container.github()` directly, and S11 does that** — but the divergence is unconfirmed. *Settled by:* reading `contracts/platform.ts:214-224` against both return points of `GET /pulls/:id`.
- **Unverified — the design bundles.** `client/specs/DevDigest Design (standalone).html` and `… (3).html` were not opened; `file://` is blocked in the browser tool. `client/INSIGHTS.md` 2026-08-02 gives a decode recipe (JSON-parse the `__bundler/manifest` line at `:170`, then base64 → gzip per entry). Every claim about the design comes from the two screenshots. *Settled by:* decoding the bundles — which may reveal a what/why/risk card that F-1 has recorded as absent, changing S15's whole visual design. **Cheap to attempt before T5 starts.**
- **The clone may be many commits behind.** `server/INSIGHTS.md` 2026-08-23 records `lastIndexedSha` 38 commits behind `HEAD`, advanced only by `POST /repos/:id/resync`. A referenced repository document read at assembly time may be stale, and blast caller line numbers are valid only at `indexed_sha` — which is why §10 permits a line only on a **changed** file.
- **Docker gate.** Per `server/INSIGHTS.md` 2026-08-20, `dockerAvailable()` (`test/helpers/pg.ts:23-32`) and testcontainers disagree about what "reachable" means, so the `.it.test.ts` files **fail rather than skip** under OrbStack. A "38 skipped" report is not a pass. Export `DOCKER_HOST` before T3 and before the verifier's integration run.
- **Grounding stops invented references; it cannot stop misdirection.** A hostile PR description — or, under D-13, a hostile referenced document — can steer the model toward a real but irrelevant file. Fencing and the system message are behavioural mitigations; the mechanical defence is D-3: the brief is display-only and nothing on the scoring or persistence path reads it, so misdirection costs a reviewer attention, never a missed severity. **Any future change that lets the brief feed the review path invalidates this.**
- **MCP was considered and declined.** `mcp/` is a fifth package shipping `mcp/src/tools/get-blast-radius.ts` and is a plausible future consumer of `GET /pulls/:id/brief`. R6 proposed a `get_brief` tool; **the user rejected it**. No step touches `mcp/`. Recorded so the next reader sees a decision, not an oversight.

---

## Handoff

- **Read first:** `server/specs/brief/01-pr-why-risk-brief.md` (binding), then `server/INSIGHTS.md` and `client/INSIGHTS.md`, then `server/src/modules/intent/references.ts`, `server/src/modules/blast/summary.ts`, `server/src/modules/reviews/prompt-log.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`, and `client/src/components/diff-viewer/FileCard/FileCard.tsx`.
- **Mode agreed and recorded in this file:** multi-agent, 13 agents. The per-track table is operative; the single-agent pass is the recorded alternative.
- **Not reviewed here:** architecture and security review are separate agents (R2 in the track table).
- **Nothing in the repository was modified by the planner.** Every command run was read-only.
- **Next stage: `/cross-review`** — an independent read by a model from another family — **not `/impl`**. No track starts until that review returns.
