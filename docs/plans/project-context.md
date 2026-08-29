# Implementation Plan: Project Context — attach repo markdown to agents and skills

**Spec:** `server/specs/project-context/01-project-context.md` (`status: approved`, 2026-08-27) — binding.
**Planned:** 2026-08-29.
**All five blocking questions are answered** (BQ-1→a, BQ-2→b, BQ-3→a, BQ-4→a, BQ-5→a). **R1–R4 accepted; R5 kept as a note only; R6 declined.** **Execution mode chosen: multi-agent, 7 tracks.**
**Amended 2026-08-29 after cross-review — F1 (unique-index NULL semantics), F2 (inert allow-list entry), F3 (clone path set but missing).** Resolutions are in their own section below.

## Requirements review

| # | Requirement (as given) | Verdict | Evidence / what settles it |
|---|---|---|---|
| REQ-1 | Server returns discovered markdown, read live from the clone | **clear** | No `project-context` module: `server/src/modules/` holds 16 dirs, none of them this; the registry lists 14 modules (`server/src/modules/index.ts:31-45`). Consumer already ships: `client/src/lib/hooks/core.ts:123-130` calls `GET /repos/${repoId}/context` typed `SpecFile[]`, comment "safe to call once API exposes it". |
| REQ-2 | `.md`/`.mdx` + allow-listed dir **segment** **or** under `.devdigest/specs/`; excluded dirs never walked; escapes refused; over-cap listed-not-attachable | **clear — and it states two predicates, not one** | `REFERENCE_DOC_DIRS` exists (`intent/constants.ts:6`). `isSafeRepoPath` is **not exported** (`intent/references.ts:78`, plain `function`; spec cites `:58-66` — line drift), **prefix-matches** at `:88` which D-2a explicitly rejects, and is a **pure string check**. `EXCLUDED_DIRS` exists (`repo-intel/constants.ts:17-26`) and contains no dot-directory, so `.devdigest/` is reached — `walk.ts:88-93` excludes by **name**, not by leading dot. **F2:** the requirement's "or it sits under `.devdigest/specs/`" is a *prefix* predicate and cannot live in a per-segment list. |
| REQ-3 | Per-document token estimate; one counter feeds display, projection and enforcement | **clear** | `container.tokenizer` verified (`platform/container.ts:134-138`), `TiktokenTokenizer` + `approxTokens` fallback (`adapters/tokenizer/index.ts:25-40`). `tokens_exact` is **not derivable** — the `Tokenizer` interface is `{ count(text): number }` and the `broken` flag is private. Resolved by **R2: omit the field**. |
| REQ-4 | Attach/detach to an agent, user-controlled order | **clear** | No attachment table in `server/src/db/schema/` — `context.ts` holds only `code_chunks`, `symbols`, `references`, `onboarding`. Ordered-link precedent: `agent_skills` (`db/schema/agents.ts:51-63`). |
| REQ-5 | Same for skills | **clear** | Same evidence. |
| REQ-6 | Skill-attached document reaches an agent only when the skill is linked **and enabled** | **clear** | SQL-enforced precedent verified: `getAgentSkillBodies` filters `eq(t.skills.enabled, true)` inside the query (`reviews/repository/skill.repo.ts:17-26`); `skills.enabled` at `db/schema/skills.ts:17`. |
| REQ-7 | Attachment records workspace + `repo_id`; other workspace → 404 | **clear** | `getContext`/`getWorkspaceId` (`modules/_shared/context.ts:14-38`); `NotFoundError` is the cross-tenant idiom (`agents/routes.ts:145-165`). Note `agent_skills` carries **no** `workspace_id` — do not copy that. |
| REQ-8 | `/context` page with Skills and Agents tabs, sidebar entry | **clear** | No `client/src/app/context/` route. `NAV` has no `context` item (`client/src/vendor/ui/nav.ts:21-36`). Label **already ships** (`shell.json` `nav.context`), active-key mapping **already ships** (`app-shell/helpers.ts:30`). |
| REQ-9 | Usage counts, a number only | **clear** | Absent; one aggregate over the new table joined to `agent_skills` + `skills.enabled`. |
| REQ-10 | Per-agent projection incl. inherited + wrapper + heading, as a fraction of 8 000, with drop marking | **clear** | Its AC-26 pairing was unverifiable as written; **settled by BQ-1/(a)** — see "Contract & DB changes" and S7. |
| REQ-11 | Run injects agent-direct then per-enabled-skill documents, in attachment order | **clear** | Engine side complete: `parts.specs` → `specsBlock` → `## Project context` (`reviewer-core/src/prompt.ts:106-109, 132`), `assembly.specs` (`:154`). The `reviewPullRequest` call at `run-executor.ts:267-296` has **no** `specs` key. |
| REQ-12 | Missing/unreadable/empty/over-cap/cross-repo → skip, run continues | **clear** | Best-effort precedent verbatim in the skills lookup at the same call site ("lookup failed — continuing without them"). |
| REQ-13 | Over budget → drop whole documents from the end, never truncate, record each | **clear** | Recently reinforced house precedent: `dropWholeItems: true` with the identical "a document cut mid-sentence can invert a must-not" rationale (`server/INSIGHTS.md` 2026-08-28; `intent/references.ts:165-179, 220-239`). |
| REQ-14 | `specs_read` lists every attachment with reasons; log lines; Prompt Assembly shows the text | **partial — the entire client half already ships** | `TraceBody.tsx` renders `specs_read` with a `none` empty state and the `specs` `PromptBlock` gated on `prompt_assembly.specs != null`. **No client implementation needed.** Server: `specs_read: []` hardcoded at `run-executor.ts:382` (success) and `:557` (partial/failure). |
| §3 out-of-scope: "no brief module is registered (`modules/index.ts:29-43`)" | **already built — rationale stale, decision stands** | `brief` **is** registered (`server/src/modules/index.ts:15,44`); `server/src/modules/brief/` ships 9 files. The decision is independently reconfirmed by the brief spec: attached documents "become a **second possible source** … adopting them is a future numbered spec's decision, made explicitly, and not a silent upgrade" (`server/specs/brief/01-pr-why-risk-brief.md:118-124`). **The brief is not widened here.** |
| §14 open: "Is `08` still free?" | **answered — yes** | `e2e/specs/` holds `01`–`07` and `09-pr-brief.flow.json`. |

### Already built — dropped from the plan entirely

Each checked with a search, not assumed:

- **`reviewer-core` needs zero changes.** `specsBlock` built, per-entry `<untrusted source="spec-N">`, joined `\n\n`, rendered `## Project context`, recorded to `assembly.specs` (`prompt.ts:106-109, 132, 154`). `wrapUntrusted` neutralises `</untrusted>` (`:31-33`). `INJECTION_GUARD` covers untrusted data (`:16-28`).
- **The trace drawer.** `TraceBody.tsx` already renders both surfaces correctly. AC-24/AC-25 get **tests only**.
- **Sidebar label + active key.** `shell.json` `nav.context`; `app-shell/helpers.ts:30`.
- **Primitives.** `Toggle` `role="switch"`/`aria-checked` (`vendor/ui/primitives/Toggle.tsx:13-16`); `Tabs` with per-tab `count` (`vendor/ui/kit/Tabs.tsx:41-46`).
- **The AC-19 idiom.** `...(skills.length > 0 ? { skills } : {})` at `run-executor.ts:267-296`, commented "so a run with no linked skills produces a byte-identical prompt to before".
- **`wrapUntrusted` is already importable server-side** — re-exported by `server/src/platform/prompt.ts`, alias present in **both** `server/tsconfig.json:22-25` and `server/vitest.config.ts:7-8`. **No new path alias is needed anywhere in this plan.**
- **`RunTrace.specs_read` needs no contract change** — `z.array(z.string())` confirmed in `vendor/shared/contracts/trace.ts`.
- **`vendor/shared` is clean right now** — `diff -rq server/src/vendor/shared client/src/vendor/shared` gives no output. That is the baseline S1 must restore.
- **`context.json` ships** with zero readers; per D-5/D-7 only `empty.body` is rewritten and new keys added.

---

## Blocking questions — all answered

| # | Question | Answer | What it fixes in the plan |
|---|---|---|---|
| BQ-1 | AC-26/AC-27 assert exact equality against a number that does not exist: `describePromptAssembly` counts `assembly.specs` (`prompt-log.ts:120-132`), which **excludes** the `## Project context` heading that `prompt.ts:132` puts in `user` | **(a)** One shared assemble module. `sectionTokens` counts heading + blocks; the projection route and `run-executor` both call it; the run emits `sectionTokens` on a run-log line; AC-26 asserts the projection equals that recorded value | S7 becomes a first-class shared module; S10 gains the recording line. D-9's "the page and the run agree" guarantee is kept intact rather than weakened to a tolerance |
| BQ-2 | The course reviewer flagged "no Context tab in the agent **and skill** editors"; REQ-8 puts tabs on `/context` and §14 leaves the editor tab open | **(b)** Build `/context` per REQ-8 **and** a read-only Context tab in `AgentEditor`, reusing the S8 projection endpoint with **no server change**. **`SkillEditor` gets nothing** | Adds S16 and one i18n key. §14's open question is answered for agents, stays open for skills. Recorded explicitly in Risks |
| BQ-3 | Symlink policy for the walk | **(a)** Skip symlinks entirely during the walk, matching `walk.ts:89` verbatim; `realpath`-contain at every read. No visited-inode set | S5's walk is a direct copy of an existing, reviewed pattern; the containment is the only genuinely new code |
| BQ-4 | Where the new contracts live | **(a)** `SpecFile` extended in `vendor/shared` (both copies mirrored); `Attachment` and `Projection` module-local in `project-context/contract.ts`, client declaring its own in its hook | Keeps the protected-zone diff to three optional fields on one file, so the contract barrier is small and short — matching `blast/contract.ts:1-26` and `brief/contract.ts:1-24` |
| BQ-5 | The e2e flow reads a live clone; `seed.ts:96` sets `clonePath: null` | **(a)** Seed a fixture clone under `server/test/fixtures/context-clone/`, point the seeded repo's `clone_path` at it, seed two attachments. It is also the video demo, so it must include a **non-leading** segment case (`server/docs/…`) | S18 gains the fixture + seed edit. See the gitignore constraint below |

**A constraint the BQ-5 answer runs into.** `node_modules/` is ignored at `.gitignore:1` with no negation for test fixtures — `git check-ignore -v server/test/fixtures/context-clone/node_modules/pkg/docs/x.md` resolves to that rule. So AC-3's excluded-directory case **cannot be a committed fixture**. It must be constructed in a temp directory by S5's unit test, where it belongs anyway (AC-3 is marked `unit`). The committed fixture carries only the positive cases plus the two negatives that *are* committable (`README.md` at root, `src/notes.md`).

## Recommendations — decided

| # | Recommendation | Severity | Status | Where it lands |
|---|---|---|---|---|
| R1 | Two nullable FKs (`agent_id`, `skill_id`) + `CHECK (num_nonnulls(agent_id, skill_id) = 1)` instead of a polymorphic `target_id`. §7 requires cascade-delete "with their workspace, repo, **agent or skill**"; a polymorphic column carries no FK and cannot cascade, leaving orphans whose `used_by_count` is permanently wrong | blocker | **Accepted** | S3 |
| R2 | Omit `tokens_exact` entirely; label everything an estimate. `TiktokenTokenizer.broken` is private and the interface exposes only `count`; the field is optional in §10 and AC-8 requires the estimate label unconditionally | should | **Accepted** | Dropped from S1's field list |
| R3 | Direct empty-array invariant test on the assemble module, separate from the AC-19 prompt test. AC-19 tests the outcome; this tests the mechanism, and the mechanism is what a later lesson will break | should | **Accepted** | S7 |
| R4 | Planted-secret fixture in a skip **reason** string, in `server/test/prompt-log.test.ts` — the repo's existing mechanical guard for §7's "a reason names a path and a cause, never content" | should | **Accepted** | S10 |
| R5 | Leave `useReindexContext` (`hooks/core.ts:132-138`) unwired and undeleted per D-7 | idea | **Note only — deliberately not a step.** It posts to `/context/reindex`, which this feature does not create. Recorded so a later reader does not "finish" it | — |
| R6 | `Tabs` `role="tab"`/`aria-selected` (`vendor/ui/kit/Tabs.tsx:25-51`) | idea | **Declined here** — its own change, affecting four shipped screens; §11 marks it "Recommended, not required here" and §14 leaves it to the front-end owner | — |

---

## The two things weighed with particular care

### 1. The security surface — reuse is **not** sufficient

**Reusing `isSafeRepoPath` does not satisfy REQ-2. The discovery walk needs its own containment.** Three independent reasons, each verified:

1. **It is not exported.** `intent/references.ts:78` declares `function isSafeRepoPath`, referenced only at `:109` and `:273` inside that file. Reuse means exporting it — changing another module's public surface — or restating it.
2. **Its final check is the wrong check.** `:88` is `REFERENCE_DOC_DIRS.some((d) => p.toLowerCase().startsWith(`${d}/`))` — a **leading-prefix** match. D-2a settled that project-context matches **any path segment**, precisely because prefix matching "in this very repository would miss `server/docs/`, `client/docs/` and `reviewer-core/specs/` — every doc directory it has". Reused unmodified it discovers nothing here; reused *modified* it changes Intent Layer behaviour, which is out of scope.
3. **It is a string check, and the threat is not a string.** No `realpath` call exists anywhere in `server/src` or `reviewer-core/src` — zero hits. And the read gate has no containment of its own: `GitClient.readFile` is `readFile(join(this.clonePathFor(repo), path), 'utf8')` (`server/src/adapters/git/simple-git.ts:142-143`), a bare `join`. A clone containing `docs/vendor-notes -> /etc` yields `docs/vendor-notes/passwd.md` — no `..`, not absolute, no null byte, under an allow-listed segment. It passes every string check and reads an arbitrary host file into a model prompt. That is REQ-2's stated failure mode arriving by the one road the string checks do not cover.

**What the difference costs.** Small, and half of it is already written. The walk half is a copy of `repo-intel/pipeline/walk.ts:73-122` — `readdir(dir, { withFileTypes: true })` at `:81`, the symlink skip at `:89` (which BQ-3/(a) adopts verbatim), POSIX relpath normalisation at `:119`, per-file `stat` size gate at `:106-115`. The genuinely new code is the read-gate containment: one `realpath` of the resolved file compared against the `realpath` of the clone root before `readFile` — roughly ten lines and one unit test.

**It must sit at the read, not only at attach.** An attachment stores a path, not content, and the clone advances independently via `POST /repos/:id/resync` (§10, "Data expectations in prose"). Attach-time validation alone is a TOCTOU hole across a resync: a path validated on Monday can be a symlink on Tuesday. This is why S5 exposes `safeDocPath()` and S7/S10 call it immediately before every read, not once at attach.

### 2. AC-19 — the byte-identical regression bar

AC-19 is **already structurally guaranteed at the `reviewer-core` layer**; the entire risk is server-side.

`prompt.ts:106-109` builds `specsBlock` as `parts.specs && parts.specs.length > 0 ? … : undefined` — so `specs: undefined` **and** `specs: []` both yield `undefined`. `:132` is `if (specsBlock) userSections.push(...)`, so the section is omitted. `:154` is `specs: specsBlock ?? null`, which is exactly what a pre-feature trace records. Nothing to change and nothing to protect there. The insertion point is likewise fixed and untouched: `## Project context` renders after `## Repo skeleton` and before `## Callers of changed symbols` (`prompt.ts:126-136`).

**The three places the bar can actually break, and the steps that carry it:**

- **S7** — the assemble module must return an **empty array**, never one containing an empty or whitespace-only string. `['']` has `length > 0`, so it would render `## Project context\n<untrusted source="spec-0">\n\n</untrusted>` for an agent whose single document was unreadable. This is why REQ-12's empty-document filter runs **inside** the assemble module, before the array is returned — not in the caller. **R3's test asserts this mechanism directly.**
- **S10** — the call site uses `...(texts.length > 0 ? { specs: texts } : {})`, matching the L02 skills line in the same object literal. Passing `[]` on a plain key would still satisfy AC-19 today, by luck of the engine's `length > 0` guard — the spread makes the guarantee a property of the call site instead of of engine internals, which is why `skills`, `callers`, `repoMap`, `prDescription` and `intent` all already use it there.
- **S10, trace half** — `specs_read` stays `[]` and `prompt_assembly.specs` stays `null` for a zero-attachment run. AC-19 says "prompt", but a plan that changed the trace document for such a run would break the same class of guarantee.

---

---

## Cross-review findings — resolutions

Reviewed by `gemini-3.6-flash`, which saw the spec, the plan verbatim and the repository
constraints, and **nothing** about how the plan was reached. Three findings; all three valid.

### F1 — R1's two-nullable-FK design needs a NULL-aware uniqueness form

**Confirmed.** In a standard Postgres unique index, `NULL` is distinct from `NULL`, so
`(agent_id, skill_id, repo_id, path)` admits two identical agent attachments — both carrying
`skill_id = NULL`. `db:generate` would succeed and the duplicate would land. This is the direct
price of R1, which we accepted for cascade-delete, and it must be paid explicitly.

**Chosen: two partial unique indexes.**

```
uniqueIndex('ctx_att_agent_repo_path_uq').on(agentId, repoId, path).where(sql`agent_id is not null`)
uniqueIndex('ctx_att_skill_repo_path_uq').on(skillId, repoId, path).where(sql`skill_id is not null`)
```

**Why this and not `UNIQUE NULLS NOT DISTINCT`** — both are available and both are generatable,
so the choice is on meaning rather than capability:

- **It states the actual invariant.** The real rule is two rules: for an agent target
  `(agent_id, repo_id, path)` is unique, and for a skill target `(skill_id, repo_id, path)` is
  unique. A four-column `NULLS NOT DISTINCT` constraint gives the same result *only because* the
  `num_nonnulls = 1` CHECK guarantees exactly one column is non-null — so correctness would
  depend on a second constraint holding. Relax or drop that CHECK and the uniqueness rule
  silently changes meaning. The partial indexes do not.
- **Each index doubles as the lookup index for its target kind.** `resolveForAgent` queries by
  `agent_id`; the agent partial index serves it directly.
- **Weaker version requirement, at no cost.** `NULLS NOT DISTINCT` needs PG15+. We are on
  **PG16** — verified in both places that matter, `docker-compose.yml:5` and
  `server/test/helpers/pg.ts:36` — so it was genuinely available. Partial unique indexes work on
  every version, and choosing them costs nothing.

**Both forms are expressible in this toolchain, checked against the installed packages rather
than documentation** (drizzle-orm 0.38.4, drizzle-kit 0.30.6): the index builder exposes
`where(condition: SQL)` at `pg-core/indexes.d.ts:67`, and drizzle-kit's `bin.cjs` interpolates
`${idx.where}` into its `CREATE INDEX` emitter. Note that `nullsNotDistinct()` lives on
`pg-core/unique-constraint.d.ts:10` — the table **constraint** builder, **not** `uniqueIndex()`;
reaching for it on the index builder is a typecheck error, and that mistake is easy to make from
memory. **S3's no-hand-written-SQL rule holds for the chosen form.**

**This changes S3's step content, stated explicitly:** the index list in S3's "Done when" is
replaced, and S3 gains its own named test — it previously deferred to S8, which is not
sufficient, because a constraint needs a test that tries to violate it. It does **not** change
the track decomposition or the agent count; T1's file set gains one test file.

### F2 — `.devdigest/specs` cannot live in a per-segment list

**Mechanism confirmed, consequence corrected.** Putting `.devdigest/specs` into a list that S5
compares *per path segment* means the entry can never match: no single segment equals
`.devdigest/specs`. AC-4 nonetheless passes, because `REFERENCE_DOC_DIRS` contains `specs`
(`intent/constants.ts:6`) and `.devdigest/specs/prd.md` matches on its own `specs` segment. The
directory is reachable: `.devdigest` is not in `EXCLUDED_DIRS` (`repo-intel/constants.ts:17-26`),
and `walk.ts:88-93` skips excluded **names**, never dot-directories as a class.

So the defect is not a failing test — it is a **list entry that silently does nothing** while a
reader reasonably believes it carries REQ-2's second predicate.

**Chosen: state the two predicates separately and implement both.** Not "drop it as redundant",
for a reason about coupling rather than tidiness: `REFERENCE_DOC_DIRS` is **owned by the `intent`
module**, and we import it. If a future change there drops `specs`, `.devdigest/specs/` discovery
would vanish silently and AC-4 would start failing for a reason with no obvious connection to
this feature. REQ-2 names two predicates; the code carries two predicates. The entry becomes
non-inert because **S5 gains a test for the prefix predicate in isolation** — one that fails if
the prefix branch is removed, regardless of what `REFERENCE_DOC_DIRS` contains.

### F3 — `clone_path` set but missing on disk

**Confirmed, and the gap is precisely where the reviewer put it.** The copied walk tolerates a
missing root: `walk.ts:79-86` catches `readdir` failure per directory, including the first call.
But **S5's containment gate is new code outside that pattern** — a `realpath` of the clone root
throws `ENOENT` when the directory is gone, and nothing in the original plan caught it. AC-2
requires "an empty list with an explicit *not cloned* reason, not a 500"; a deleted clone must
reach the same outcome with a reason that **distinguishes it from never-cloned**.

Resolved with a three-value reason vocabulary on the module-local list envelope (S2), a single
root resolution per request that classifies its own failure (S5), the empty-list-with-reason
response (S8), copy for the new reason (S12, rendered in S15), and — because the same gate is
shared — one clause in S10 so a run against a deleted clone skips every document and completes,
per §6's "Every attached document fails" row, rather than throwing out of the containment call.

## Goal & scope

Ship the `project-context` server module, the `/context` page with its Agents and Skills tabs, a read-only Context tab in the agent editor, and the run-time injection path — so markdown in a repo's allow-listed documentation directories can be discovered, attached to agents and skills, projected against an 8 000-token budget per agent, injected into review prompts as untrusted project context, and read back in the run trace. Done means AC-1 through AC-31 pass and an agent with attached documents demonstrably changes its prompt: REQ-11 and REQ-14 are what make this real rather than decorative.

**Out of scope:**
- Any change to `reviewer-core` — the `specs` path is complete (`prompt.ts:106-109, 132, 154`).
- Any change to the `RunTrace` or `PromptAssembly` contracts.
- Widening the PR brief to consume attached documents (`server/specs/brief/01-pr-why-risk-brief.md:118-124`).
- **`SkillEditor`** — no tab bar, no Context tab (BQ-2/b). See Risks.
- Editing/creating/renaming/deleting documents (D-5); version history or diffing (D-8); indexing, embedding, chunking, Re-index button, index status (D-7); repo-wide discovery (D-2).
- Deleting the superseded `context.json` keys (`chunks`, `reindex`, `indexing`, `resync`, `indexStatus`, `mode.*`, `editor.*`) — left unused per D-5/D-7.
- Wiring `useReindexContext` (R5 note).
- The `Tabs` accessibility fix (R6, declined).
- `tokens_exact` (R2).

## Affected packages

| Package | Why it's touched | Risk |
|---|---|---|
| `server/` | New `project-context` module, new table + generated migration, `SpecFile` extension in `vendor/shared`, run-executor injection, registry line, test fixture + seed edit | **High** — enters both do-not-touch zones; `run-executor.ts` is the shared studio+CI path and carries AC-19 |
| `client/` | Mirrored `vendor/shared`, `/context` route, cross-route `ProjectionSummary`, `AgentEditor` Context tab, hooks, nav item, i18n, trace-drawer tests | Medium — the trace drawer needs tests only; `AgentEditor.tsx`'s tab ternary must become a map |
| `e2e/` | `08-project-context.flow.json` | Low — `08` verified free |
| `reviewer-core/` | **Not touched.** Listed so no one adds it; its typecheck is a verification gate proving so | — |
| `mcp/` | **Not touched.** | — |

## Constraints in force

- `server/src/vendor/shared/` and `server/src/db/migrations/` are do-not-touch without coordination — source: root `CLAUDE.md` "Do-not-touch".
- The two vendored copies must stay byte-identical, checkable with `diff -rq server/src/vendor/shared client/src/vendor/shared` — source: `server/INSIGHTS.md` 2026-08-17 (five files drifted undetected once). **Clean at planning time.**
- Never hand-write migration SQL: schema file → `pnpm db:generate` → `pnpm db:migrate`; new columns get their own migration — source: `server/INSIGHTS.md` Tool & Library Notes 2026-06-14.
- ESM `.js` extensions on relative imports in `server/`, `reviewer-core/`, `e2e/`; **not** `client/` — source: root `CLAUDE.md`; visible at `server/src/modules/index.ts:2-15`.
- Every domain table carries `workspace_id`; every handler resolves tenancy via `getContext(app.container, req)` — source: `server/CLAUDE.md`; `modules/_shared/context.ts:14-38`.
- Modules register statically, one import + one entry; the loop at `server/src/app.ts:166-169` registers with **no prefix**, so a new module owning `/repos/:id/context` is legitimate (`repo-intel` already owns `/repos/:id/*` routes).
- Validation is Zod; request-validation failure → **422** `{error:{code:'validation_error'}}` — source: `server/src/app.ts:116-127`.
- **`server/` and `reviewer-core/` test files are never typechecked** (`"include": ["src/**/*.ts"]`) — a green typecheck is not evidence the suites pass. The client is the opposite. Source: `server/INSIGHTS.md` 2026-08-17.
- Client tests use `fireEvent`; `@testing-library/user-event` is not installed and fails at import — source: `client/INSIGHTS.md` 2026-08-02. **This overrides the `react-testing-library` skill's default advice.**
- Client styling is colocated `styles.ts` (`satisfies CSSProperties`) + CSS custom properties, not Tailwind. `.tnum` (`vendor/ui/styles.css:221-223`) is the sanctioned tabular-numerals class and the one legitimate bare `className` — source: `client/INSIGHTS.md` 2026-08-28. §6 requires tabular numerals for token counts.
- `Button`'s variant prop is `kind`, not `variant` — source: `client/INSIGHTS.md` 2026-08-17.
- Cross-route shared components live in `client/src/components/<Name>/` with an `index.ts` barrel; route-local ones in `_components/` — source: `client/INSIGHTS.md` 2026-06-14. This is why `ProjectionSummary` is cross-route (S14).
- i18n: `en` only; a missing key renders the raw key, not an error — source: `client/INSIGHTS.md` 2026-06-14.
- `INSIGHTS.md` writes are append-only — source: root `CLAUDE.md`.
- **Precedence:** package `INSIGHTS.md` → package `CLAUDE.md` → root `CLAUDE.md` → skill → general practice.
- **Never read or cite `server/clones/`** — a runtime self-clone of stale duplicates (also gitignored).
- **Deployment target is Postgres 16**, pinned identically in `docker-compose.yml:5` and `server/test/helpers/pg.ts:36` (`pgvector/pgvector:pg16`). Relevant to F1.
- **Do-not-touch entered:**
  - `server/src/vendor/shared/contracts/platform.ts` — **S1**, unavoidable: §10 requires extending `SpecFile`, and the shipped `useContextFiles` is already typed against it. Its own step, mirrored, `diff -rq`-verified.
  - `server/src/db/migrations/` — **S3**, unavoidable and **generated only**: `pnpm db:generate` writes `0014_*.sql`. No existing migration is edited; no SQL is hand-written.

## Existing scaffolding check

| Asset | Location | How it is used |
|---|---|---|
| `useContextFiles` | `client/src/lib/hooks/core.ts:123-130` | Already calls `GET /repos/:id/context` typed `SpecFile[]`. S8 makes the route real; the hook is used **unchanged**. |
| `SpecFile`, `IndexStatus` | `vendor/shared/contracts/platform.ts:259-274` | `SpecFile` extended in S1; `IndexStatus` untouched (D-7). |
| `REFERENCE_DOC_DIRS` | `intent/constants.ts:6` | Imported by S4 as the **segment** allow-list. **F2:** `.devdigest/specs/` is a separate **prefix** predicate, not a list entry. |
| `EXCLUDED_DIRS` | `repo-intel/constants.ts:17-26` | Imported by S5's walk. Contains no dot-directory, so `.devdigest/` is reachable. |
| `walkClone` | `repo-intel/pipeline/walk.ts:73-122` | The pattern S5 copies: `withFileTypes`, symlink skip at `:89` (BQ-3/a), POSIX relpath at `:119`, `stat` size gate at `:106-115`, unreadable-dir catch at `:82-86`. |
| `container.tokenizer` | `platform/container.ts:134-138` | The single counter for REQ-3/10/13; overridable via `ContainerOverrides.tokenizer` in tests. |
| `wrapUntrusted` | `reviewer-core/src/prompt.ts:31`, re-exported at `server/src/platform/prompt.ts` | S7 calls it so projection blocks are byte-identical to the engine's. Alias in `tsconfig.json` **and** `vitest.config.ts` already. |
| Enabled-skill SQL filter | `reviews/repository/skill.repo.ts:17-26` | The pattern S6 mirrors for REQ-6 — filter in SQL so no caller can forget. |
| Best-effort try/catch | `run-executor.ts:267-296` (skills lookup) | The shape S10 copies for REQ-12. |
| `...(x.length > 0 ? {x} : {})` | same call site | The AC-19 carrier. |
| `TraceBody` rendering | `.../[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` | **Zero implementation** — `specs_read` list with `none` state; `specs` `PromptBlock` gated on `!= null`. S17 adds tests only. |
| `PromptBlock` | `.../RunTraceDrawer/_components/PromptBlock/PromptBlock.tsx` | Collapsible + copy + fullscreen. Untouched. |
| `Toggle`, `Tabs` | `vendor/ui/primitives/Toggle.tsx:13-16`, `vendor/ui/kit/Tabs.tsx` | Attach control and both tabs. `getByRole("switch")` is the stable handle (`client/INSIGHTS.md` 2026-08-02). |
| `MonoLink` + `srOnly` pattern | `WhyRiskCard.tsx` `FileRef`/`FocusRow` | §6's middle-truncated path with the full value in an `srOnly` span — already solved, do not reinvent. |
| `Badge` + local `*_META` record | `IntentCard/constants.ts`, `WhyRiskCard/constants.ts` | The standing pattern for a categorical band rendered as a **word** (WCAG AA). Use for `origin` and `outcome` — §6 forbids colour alone. |
| `useActiveRepo` | `client/src/lib/repo-context`, consumed at `app-shell/hooks/useShellContext.ts:27` | How `/context` resolves the current repo and detects §6's "no repo selected". |
| Sidebar label + active key | `shell.json` `nav.context`; `app-shell/helpers.ts:30` | Only the `NAV` item is missing. |
| `context.json` | `client/messages/en/context.json` | Zero readers. `title`, `loadError`, `kb` reused; `empty.body` rewritten (D-1). |
| Module-local contract precedent | `blast/contract.ts:1-26`, `brief/contract.ts:1-24` | The basis for BQ-4/(a). |
| `AgentEditor` `TABS` | `AgentEditor/constants.ts` | Two entries today. S16 adds a third — and **`AgentEditor.tsx:24` dispatches with a two-way ternary (`tab === "skills" ? … : …`) that must become a map or switch**. |

---

## Steps

### S1 — Extend `SpecFile`, mirror it, prove parity *(protected zone)*
- **Files:** `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`
- **Skill:** `zod`, `typescript-expert`
- **Test:** extend `server/test/contracts.test.ts` with a `SpecFile` fixture — all fields present, and all optional fields absent
- **Depends on:** —
- **Done when:** `tokens_estimate`, `over_cap`, `used_by_count` are `.nullish()` on `SpecFile` (**`tokens_exact` omitted per R2**); the barrel `vendor/shared/index.ts` is **not** edited (`platform.js` already exported at `:23`); the client file is a byte-identical mirror; and `diff -rq server/src/vendor/shared client/src/vendor/shared` prints nothing. All three fields optional ⇒ no existing fixture breaks.

### S2 — Module-local contracts *(BQ-4/a; amended by F3)*
- **Files:** `server/src/modules/project-context/contract.ts` (new)
- **Skill:** `zod`
- **Test:** `server/test/project-context-contract.test.ts` — parse a live route response against each schema, the pattern `blast` uses to keep its copies honest
- **Depends on:** S1
- **Done when:** `ContextDocList`, `AttachmentInput`, `AttachmentRow`, `Projection`, `ProjectionEntry` are declared with the §10 field names (`origin`, `via_skill_id`, `outcome` ∈ `injected|dropped_budget|skipped`, `budget_tokens`, `projected_tokens`), **`ContextDocList` carries `reason: 'not_cloned' | 'clone_missing' | null`** (F3 — three distinct outcomes, never conflated), plus `capped: boolean` and the clone's last-synced time (§6 Freshness); a header comment names this file the source of truth and cites `blast/contract.ts:1-26` for why it is not shared.

### S3 — Attachment table + generated migration *(protected zone; R1; amended by F1)*
- **Files:** `server/src/db/schema/context.ts` (append `contextAttachments`), `server/src/db/migrations/0014_*.sql` (**generated**)
- **Skill:** `postgresql-table-design`, `drizzle-orm-patterns`
- **Test:** **`server/test/project-context-schema.it.test.ts` (new)** — insert the same agent attachment twice and expect the second to **fail** on the partial unique index; the same for a skill attachment; and a `num_nonnulls` violation (both FKs set, and neither set) rejected. **F1: a constraint needs a test that tries to violate it — deferring to S8 was not sufficient.**
- **Depends on:** S2
- **Done when:** columns are `id`, `workspace_id`, `repo_id`, **`agent_id` and `skill_id` both nullable FKs (R1)**, `path`, `order`, `created_at`; a `CHECK (num_nonnulls(agent_id, skill_id) = 1)` constraint; every FK `ON DELETE CASCADE` so §7's lifecycle holds; **two partial unique indexes — `ctx_att_agent_repo_path_uq` on `(agent_id, repo_id, path) WHERE agent_id IS NOT NULL` and `ctx_att_skill_repo_path_uq` on `(skill_id, repo_id, path) WHERE skill_id IS NOT NULL` (F1)** — declared with drizzle's `uniqueIndex(...).on(...).where(sql`…`)` (`pg-core/indexes.d.ts:67`), **not** a four-column unique index, which Postgres would treat as satisfied by two rows that both have `skill_id = NULL`; a lookup index on `(workspace_id, repo_id)`; and `pnpm db:generate` then `pnpm db:migrate` succeed **with no hand-edited SQL** — verified achievable, drizzle-kit 0.30.6 emits the `WHERE` clause. `target_kind`/`target_id` remain the wire shape (§10), mapped at the repository boundary.

### S4 — Module constants *(amended by F2)*
- **Files:** `server/src/modules/project-context/constants.ts` (new)
- **Skill:** —
- **Test:** none — no behaviour change
- **Depends on:** —
- **Done when:** **two allow-list constants with distinct matching semantics are exported, named so the semantics cannot be confused (F2):** `CONTEXT_DOC_DIR_SEGMENTS` = `REFERENCE_DOC_DIRS` (matched **per path segment**, D-2a) and `CONTEXT_DOC_PATH_PREFIXES` = `['.devdigest/specs/']` (matched as a **leading path prefix**, REQ-2's second predicate). **`.devdigest/specs` must not appear in the segment list — a two-segment string can never match a per-segment comparison, and a list entry that silently does nothing is worse than no entry.** Also exported: `MD_EXTENSIONS`, `MAX_DOC_BYTES = 64 * 1024`, `MAX_LISTED_DOCS = 500`, `MAX_ATTACHMENTS_PER_TARGET = 20`, `PROJECT_CONTEXT_TOKEN_BUDGET = 8_000` are exported, each carrying its §7 rationale in a comment (the 64 KB cap cites `skills/import.ts:33-34`; the 8 000 cites D-4's "held separately from the skills budget"). Each constant carries a comment naming **which** predicate it feeds.

### S5 — Discovery walk and the containment gate *(the REQ-2 security step; BQ-3/a; amended by F2 and F3)*
- **Files:** `server/src/modules/project-context/discovery.ts` (new)
- **Skill:** `security` (guardrail while writing), `typescript-expert`
- **Test:** `server/test/project-context-discovery.test.ts` — AC-3 (root `README.md`, `src/notes.md`, `node_modules/pkg/docs/x.md` all absent — **built in a temp dir, because `node_modules/` is gitignored at `.gitignore:1` and cannot be a committed fixture**), AC-4 (`.devdigest/specs/prd.md` present), **a prefix-predicate test in isolation (F2): `.devdigest/specs/prd.md` is discovered with the segment list stubbed to exclude `specs`, so the test fails if the prefix branch is removed** — this is what makes the entry non-inert and decouples the guarantee from another module's list, AC-5 (`../../../etc/passwd`, absolute, null byte, Windows drive all rejected), AC-7 (positive integer estimate, stable across repeat calls), a **symlink-escape case** (`docs/x -> /etc` yields nothing and reads nothing), a **non-leading-segment case** proving `server/docs/b.md` is found where a prefix match would miss it (D-2a), and **a missing-clone-root case (F3): a `clone_path` pointing at a deleted directory yields an empty list with the `clone_missing` reason and never throws**
- **Depends on:** S4
- **Done when:** the walk skips `EXCLUDED_DIRS` and **skips symlinks entirely** (BQ-3/a, `walk.ts:89` verbatim), matches `.md`/`.mdx` when **either** predicate holds — `hasAllowedSegment(rel) || hasAllowedPrefix(rel)` — with **both implemented, per F2's chosen resolution**; marks `over_cap` above `MAX_DOC_BYTES` without excluding the row, caps at `MAX_LISTED_DOCS` with a flag, tolerates unreadable directories the way `walk.ts:82-86` does; and `safeDocPath()` performs the string checks **and** a `realpath` containment check against the clone root, and is called at the last gate before **every** read — not only at attach time; and **the clone root is resolved once per request through a helper that classifies its own failure (F3): `ENOENT` ⇒ return the `clone_missing` outcome rather than throwing, any other error (e.g. `EACCES`) ⇒ propagate to the existing error handling so §6's "Clone unreadable" copy still applies. A `realpath` that throws must never surface as a 500.**

### S6 — Repository and service
- **Files:** `server/src/modules/project-context/repository.ts`, `service.ts` (new)
- **Skill:** `drizzle-orm-patterns`
- **Test:** covered by S8 (AC-9, AC-13, AC-16, AC-30) and S3 (constraint behaviour)
- **Depends on:** S3, S5
- **Done when:** attachment CRUD is workspace-scoped **in SQL**; `resolveForAgent(agentId)` returns direct attachments then per-skill attachments ordered by `agent_skills.order` then attachment `order`, filtering `skills.enabled = true` **inside the query** (mirroring `skill.repo.ts:17-26` so no caller can forget); `usageCounts()` returns per-document and per-skill counts (REQ-9); `MAX_ATTACHMENTS_PER_TARGET` is enforced on attach; over-cap documents are refused at attach (AC-6); **a duplicate attach returns a clean domain error rather than surfacing the raw unique-violation** (F1's index is the backstop, not the UX).

### S7 — The shared assemble module *(BQ-1/a — carries AC-19, AC-22, AC-26, AC-27)*
- **Files:** `server/src/modules/project-context/assemble.ts` (new)
- **Skill:** `typescript-expert`
- **Test:** `server/test/project-context-assemble.test.ts` — **AC-19** (empty input ⇒ empty array, zero section), AC-22 (overflow drops **whole** documents from the end, never truncates, records each), AC-10 (order preserved), plus **R3's direct empty-array invariant** (`assemble([]) → { texts: [], sectionText: '', sectionTokens: 0 }`)
- **Depends on:** S4, S5
- **Done when:** one exported function takes ordered resolved documents plus `container.tokenizer` and returns `{ entries, texts, sectionText, sectionTokens, skipped, dropped }`; it calls `wrapUntrusted` imported from `@devdigest/reviewer-core` so blocks are byte-identical to the engine's; **`sectionTokens` counts the `## Project context` heading plus the joined blocks** (BQ-1/a); empty and whitespace-only documents are filtered **inside** it so `texts` can never contain `''`; `texts` is `[]` when nothing survives; skip and drop reasons name a path and a cause and **never content** (§7). This one function is called by both S8's projection route and S10's run path — that shared call is what makes AC-26 and AC-27 true.

### S8 — Routes *(amended by F3)*
- **Files:** `server/src/modules/project-context/routes.ts` (new)
- **Skill:** `fastify-best-practices`, `zod`, `security`
- **Test:** `server/test/project-context.it.test.ts` — AC-1, AC-2 (null `clone_path` ⇒ empty list + `not_cloned`, **not a 500**), **a missing-clone-directory case (F3): `clone_path` set but the directory deleted ⇒ empty list + `clone_missing`, distinct from `not_cloned`, and not a 500**, AC-5 (422 envelope), AC-6, AC-9, AC-13 (cross-workspace ⇒ **404, never 403**), AC-17 (server half), AC-27, AC-30 (server half), AC-31
- **Depends on:** S2, S6, S7
- **Done when:** the module default-exports an async Fastify plugin using `withTypeProvider<ZodTypeProvider>()`; `GET /repos/:id/context` matches the shipped hook's URL **exactly**; attach/detach/reorder routes exist for agent and skill targets; `GET /agents/:id/context/projection` returns the §10 projection computed via S7; every handler calls `getContext(app.container, req)` and throws `NotFoundError` for another workspace's row; **all three list outcomes are distinguishable by the client — documents present, `not_cloned`, `clone_missing` — and none of the three is a 5xx (F3)**; no `response:` schema is declared, matching every other route in this server.

### S9 — Registry
- **Files:** `server/src/modules/index.ts` (+1 import, +1 entry)
- **Skill:** —
- **Test:** extend `server/test/routes-smoke.test.ts`
- **Depends on:** S8
- **Done when:** `projectContext` is imported with a `.js` extension and added to the `modules` record, and the app boots.

### S10 — Run injection, trace population, `sectionTokens` recording *(BQ-1/a; R4; amended by F3 — carries AC-19, REQ-11, REQ-14)*
- **Files:** `server/src/modules/reviews/run-executor.ts` (inside `runOneAgent`; the `reviewPullRequest` call at `:267-296`; `specs_read` at `:382`)
- **Skill:** `typescript-expert`, `security`
- **Test:** extend `server/test/reviews.it.test.ts` — AC-18, AC-11, AC-12, AC-20, AC-21 (cross-repo document skipped and **no same-named file from the repo under review is read**), AC-22, AC-23, AC-26, AC-27, AC-31; a unit test for **AC-19** (zero-attachment agent ⇒ prompt byte-identical to the pre-feature baseline); **an every-document-fails case (F3): the clone directory deleted ⇒ the run completes with no project-context section and records all skips, per §6**; and **R4** — extend `server/test/prompt-log.test.ts` with a planted-secret fixture in a **skip reason** string
- **Depends on:** S7, S9
- **Done when:** resolution happens inside `runOneAgent` in a try/catch mirroring the skills lookup ("continuing without them"); **the containment helper's classified failure is treated as "every document skipped", so a deleted clone yields skips and a completed run rather than an exception escaping into the catch as an opaque failure (F3)**; `specs` is passed as `...(texts.length > 0 ? { specs: texts } : {})`; **the run emits `sectionTokens` on a run-log line** (BQ-1/a) so AC-26 has a recorded value to assert against; `specs_read` at `:382` carries every attachment — injected ones as a bare path, skipped and dropped ones as path + reason; one run-log line per skip or drop; **no document text reaches any log line**; and `buildPartialTrace`'s `specs_read: []` at `:557` is left as-is (assumption A2).
- **Test-mechanics note:** use `waitForTrace(app, runId)` from `test/helpers/runs.ts`, never `waitForPrRuns` alone, when asserting on `prompt_assembly` (`server/INSIGHTS.md` 2026-08-17).

### S11 — Client hooks
- **Files:** `client/src/lib/hooks/project-context.ts` (new), `client/src/lib/hooks/index.ts` (+1 export)
- **Skill:** `react-best-practices`
- **Test:** covered by S14/S15/S16
- **Depends on:** S8
- **Done when:** attachment and projection hooks exist over `client/src/lib/api.ts`, with envelope types declared **locally** per BQ-4/(a) (the `hooks/blast.ts` precedent), **including the three-value `reason` (F3)**; `useContextFiles` in `core.ts` is used **unchanged**; `useReindexContext` is left untouched and unwired (**R5 note**); mutation failure surfaces and reverts the toggle rather than optimistically succeeding (§9).

### S12 — i18n *(amended by F3)*
- **Files:** `client/messages/en/context.json`, `client/messages/en/agents.json` (+`editor.tabs.context`)
- **Skill:** —
- **Test:** covered by S14/S15/S16
- **Depends on:** —
- **Done when:** `empty.body` is rewritten for the per-target model and names the allow-listed directories (**D-1 makes this copy change part of this spec** — the shipped text states the opposite model, "Every agent and the PR brief read them"); new keys exist for the tokens total (**superseding, not reusing, `chunks`** — D-7), both tab labels, the estimate marker, the budget fraction, origin and outcome words, the no-agent-in-view copy, the skill contribution figure, the capped-list notice, **and two distinct reason strings — one for "repository not cloned yet" and one for "the clone is missing on disk", which must not share copy (F3)**; `agents.json` gains `editor.tabs.context`; the superseded keys are left in place, unused.

### S13 — Sidebar nav item
- **Files:** `client/src/vendor/ui/nav.ts` (+1 item)
- **Skill:** —
- **Test:** covered by S18
- **Depends on:** —
- **Done when:** a `context` item with `href: "/context"` sits in the `WORKSPACE` group. The label (`shell.json` `nav.context`) and the active-key mapping (`app-shell/helpers.ts:30`) already exist and are **not** edited.

### S14 — `ProjectionSummary` cross-route component
- **Files:** `client/src/components/ProjectionSummary/{ProjectionSummary.tsx,index.ts,styles.ts,constants.ts,ProjectionSummary.test.tsx}` (new)
- **Skill:** `react-best-practices`, `react-testing-library` (**`fireEvent` override**)
- **Test:** colocated — AC-17 (projected total covers all three documents plus wrapper plus heading, rendered as a fraction of 8 000), AC-28 (no agent ⇒ estimates only, no total, no fraction, copy says an agent is required), AC-30 (all skills disabled ⇒ direct only, disabled ones shown as not contributing)
- **Depends on:** S11, S12
- **Done when:** it is a **pure render of the server's projection payload** — it computes no totals; it lives in `client/src/components/` because both `/context` and the agent editor consume it (`client/INSIGHTS.md` 2026-06-14); `origin` and `outcome` render as **words** via `Badge` + a local `*_META`, never colour alone (§6); numbers carry `.tnum`; and it degrades per §9 — on a missing projection it says so rather than summing rows.

### S15 — The `/context` page *(amended by F3)*
- **Files:** `client/src/app/context/page.tsx` (new, thin route entry per `conventions/page.tsx`), `client/src/app/context/_components/ProjectContextView/{ProjectContextView.tsx,index.ts,styles.ts,constants.ts,ProjectContextView.test.tsx}`, plus `_components/DocumentList/`, `_components/AgentsTab/`, `_components/SkillsTab/`
- **Skill:** `next-best-practices`, `react-best-practices`, `react-testing-library` (**`fireEvent` override**)
- **Test:** colocated — AC-8 (estimate marker present, no copy claims exactness), AC-15 (empty state, not a blank list), AC-16 (usage count reads 2), AC-29 (skill contribution shown with no fraction and no drop marking), **plus both empty-with-reason states rendering distinct copy (F3)**
- **Depends on:** S13, S14
- **Done when:** the page reads the repo from `useActiveRepo` and prompts to select one when absent (§6); the document list, both tabs and `ProjectionSummary` render; **`not_cloned` and `clone_missing` render as distinct, non-error empty states — a deleted clone is not an error toast (F3)**; `styles.ts` + CSS custom properties, **no Tailwind**; long paths middle-truncate with the full value in an `srOnly` span per `WhyRiskCard`'s `FileRef`; the clone's last-synced time is surfaced and the page adds **no refresh affordance of its own** (D-7/§6 Freshness); no test imports `userEvent`.

### S16 — `AgentEditor` Context tab *(BQ-2/b)*
- **Files:** `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (+1 `TABS` entry), `AgentEditor.tsx` (**tab dispatch**), `_components/ContextTab/{ContextTab.tsx,index.ts,styles.ts}` (new), extend `AgentEditor.test.tsx`
- **Skill:** `react-best-practices`, `react-testing-library` (**`fireEvent` override**)
- **Test:** extend `AgentEditor.test.tsx` — the Context tab renders, is switchable, and is **read-only** (no attach control)
- **Depends on:** S14, S15
- **Done when:** a `context` entry with `labelKey: "editor.tabs.context"` is added to `TABS`; **`AgentEditor.tsx:24`'s two-way ternary `tab === "skills" ? <SkillsTab/> : <ConfigTab/>` is replaced by a map or switch** — adding a third branch to that ternary is the defect this line is set up to invite; `ContextTab` lists that agent's attachments and reuses `ProjectionSummary`, consuming the **same S8 projection endpoint with no server change**; it offers no attach/detach control — attaching stays on `/context` per D-1.

### S17 — Trace drawer tests *(no implementation)*
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.test.tsx` (new)
- **Skill:** `react-testing-library` (**`fireEvent` override**)
- **Test:** AC-24 (a "Project context" block expands to the full injected text; "Specs read" lists every attachment with its outcome), AC-25 (no project context ⇒ no block, and "Specs read" shows its `none` state)
- **Depends on:** —
- **Done when:** both pass against **unmodified** `TraceBody.tsx`. If either needs a source change, that is a finding to report, **not a change to make** — §11 settled that the code wins and nothing is added to the drawer.

### S18 — e2e flow 08 + fixture clone + seed *(BQ-5/a)*
- **Files:** `e2e/specs/08-project-context.flow.json` (new), `server/test/fixtures/context-clone/**` (new — the directory does not exist), `server/src/db/seed.ts` (`clonePath` at `:96`, plus two attachment rows)
- **Skill:** —
- **Test:** the flow is the test — AC-14, AC-24 (e2e half)
- **Depends on:** S16
- **Done when:** the fixture contains at minimum `docs/a.md` (leading segment), **`server/docs/intent-layer.md` (non-leading segment — the case a prefix match misses, proving D-2a, and the one worth showing on video)**, `.devdigest/specs/prd.md` (AC-4), plus committable negatives `README.md` at root and `src/notes.md`; **the `node_modules/` negative is NOT committed** (gitignored at `.gitignore:1`) and lives in S5's temp-dir unit test instead; `seed.ts` points the seeded repo's `clone_path` at the fixture and seeds two attachments; `08` is used (verified free — `01`–`07` and `09` are taken); the flow covers the page, both tabs, the projection with its drop marking, the agent-editor Context tab and the trace drawer's project-context block; and it **calls no LLM**, satisfied structurally by never triggering a run, the way flow `09` satisfies its own no-LLM criterion.

### S19 — Record findings
- **Files:** `server/INSIGHTS.md`, `client/INSIGHTS.md` (**append-only**)
- **Skill:** `engineering-insights`
- **Test:** none
- **Depends on:** S18
- **Done when:** genuinely non-duplicate, file-grounded findings are appended. Candidates: the `realpath` gap at `simple-git.ts:142-143`; `isSafeRepoPath` being private and prefix-matching where D-2a needs segment matching; the heading-vs-`assembly.specs` boundary settled by BQ-1; `seed.ts:96`'s null `clone_path` as an e2e constraint; the gitignored-fixture constraint on `node_modules/` test cases; **and the F1 pairing — a nullable-FK polymorphic target needs partial unique indexes, because a plain unique index treats `NULL` as distinct and admits duplicates**. Re-read both files first; write nothing if nothing is substantial.

---

## Contract & DB changes

**Contract (S1).** `SpecFile` gains `tokens_estimate`, `over_cap`, `used_by_count` — all `.nullish()`, **`tokens_exact` omitted per R2** — in `server/src/vendor/shared/contracts/platform.ts:259-265`. The file is then **mirrored byte-identically** to `client/src/vendor/shared/contracts/platform.ts`. The barrel `server/src/vendor/shared/index.ts` is **not** edited: `platform.js` is already exported at `:23`, and the barrel's own rule is "feature agents EXTEND with new files, they do not edit existing ones". All three fields optional ⇒ no existing fixture breaks, including `server/test/contracts.test.ts`.

`RunTrace.specs_read` stays `z.array(z.string())` — **no contract edit, no fixture break**, exactly as §10 states and as verified in `vendor/shared/contracts/trace.ts`.

`Attachment` and `Projection` stay module-local in `server/src/modules/project-context/contract.ts` (BQ-4/a), with the client declaring its own in `client/src/lib/hooks/project-context.ts` — the pattern `blast` and `brief` both use, for the recorded reason that no route in this server declares a `response:` schema, so a shared response contract "would buy types only, at the cost of entering a do-not-touch zone".

**Parity check.** Run `diff -rq server/src/vendor/shared client/src/vendor/shared` **before** S1 (clean at planning time) and again after the mirror. It must print nothing. This is a named step in both execution modes, because these copies drifted across five files undetected once.

**The BQ-1 boundary, stated so it is not rediscovered.** `describePromptAssembly` records `tokens: countTokens(assembly.specs)` (`prompt-log.ts:120-132`), and `assembly.specs` is the joined wrapped blocks **without** the `## Project context` heading — `prompt.ts:132` puts the heading in `user`. So the existing per-section number can never equal a projection that includes the heading, as REQ-10 requires. BQ-1/(a) resolves this by having S7 own a `sectionTokens` that counts heading + blocks, and S10 record it on a run-log line. **`prompt-log.ts` is not modified** — its existing `specs` section stat keeps its current meaning; the new number is additional, not a redefinition.

**DB (S3).** Append `contextAttachments` to `server/src/db/schema/context.ts`, then `pnpm db:generate` (drizzle-kit emits `0014_*.sql`), then `pnpm db:migrate`. **No SQL is hand-written; no existing migration is touched.** The server does **not** migrate on boot, so the migration must be applied explicitly before any integration test runs.

---

## Verification

| Package | Command | Gate | Stage |
|---|---|---|---|
| `server/` | `pnpm typecheck` | must pass | implementer (per track), plan-verifier |
| `server/` | `pnpm exec vitest related <changed files>` | fast feedback on own diff | implementer (during) |
| `server/` | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | unit; must pass | implementer (end of track) |
| `server/` | `pnpm exec vitest run .it.test` | integration, real Postgres via testcontainers — **now includes the S3 constraint test** | plan-verifier |
| `server/` | `pnpm db:generate && pnpm db:migrate` | migration applies cleanly | implementer (S3 only) |
| `client/` | `pnpm typecheck` | must pass — client tests **are** typechecked | implementer, plan-verifier |
| `client/` | `pnpm test` | vitest + jsdom, colocated | implementer (end of track), plan-verifier |
| `reviewer-core/` | `npm run typecheck` (installs with **`npm ci`**, not pnpm) | must pass — **proves it was not modified** | plan-verifier |
| `e2e/` | `npm test` → `tsx run.ts` (**not Playwright**); `./scripts/e2e.sh` locally | **optional** — needs the full stack via `./scripts/dev.sh` | plan-verifier |
| — | `diff -rq server/src/vendor/shared client/src/vendor/shared` | must print nothing | implementer (S1), plan-verifier |

No lint row: there is no ESLint, Biome or Prettier config and no `lint` script in any package.

**Staging is deliberate and non-overlapping.** Each `implementer` runs typecheck plus `vitest related` on its own diff during the track and the full package unit suite once at the end of it. `plan-verifier` runs the integration suites and the cross-package gates **once**, as the gate. No two stages run the same suite.

**Permission prompts to expect.** `.claude/settings.local.json` allows only three git commands, and the single project hook guards writes under `specs/` only — so the executing agents will be prompted for `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm exec vitest`, `pnpm db:generate`, `pnpm db:migrate`, `npm ci`, and `docker compose`. Approve them up front rather than letting a track stall mid-run.

**Two environment traps, both recorded and both cheap to hit.**
1. Integration tests need Docker, and `dockerAvailable()` disagrees with testcontainers about "reachable": under OrbStack the suites **fail** rather than skip, reporting 7 failed files and 38 skipped tests — easy to misread as success. Export `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` (`server/INSIGHTS.md` 2026-08-20). **S3's new constraint test is an `.it.test`, so it is subject to this.**
2. On a fresh clone `pnpm install` exits 1 on `ERR_PNPM_IGNORED_BUILDS`; set the `allowBuilds:` placeholders in the generated `pnpm-workspace.yaml` files to `true` (`server/INSIGHTS.md` 2026-08-02).

**One assertion trap that will bite S10.** `JSON.stringify(llm.calls)` escapes quotes, so `.toContain('<untrusted source="spec-0">')` can never match — it is stored as `source=\"spec-0\"`, and the failure reads like a missing prompt section rather than a broken assertion. Assert against `trace.prompt_assembly.user` or the raw rendered content (`server/INSIGHTS.md` 2026-08-28).

### Acceptance criteria carried from the spec

| AC | From spec | Verified by | Covered by step |
|---|---|---|---|
| AC-1 | REQ-1 | integration | S8 (with S5) |
| AC-2 | REQ-1 | integration | S8 (`not_cloned`; `clone_missing` is its F3 sibling case) |
| AC-3 | REQ-2 | unit | S5 (temp dir — `node_modules/` is gitignored) |
| AC-4 | REQ-2 | unit | S5 (both predicates, incl. the isolated prefix test) |
| AC-5 | REQ-2 | unit | S5 (rejection) + S8 (422 envelope) |
| AC-6 | REQ-2 | integration | S5 + S6 + S8 |
| AC-7 | REQ-3 | unit | S5 |
| AC-8 | REQ-3 | unit (client) | S15 |
| AC-9 | REQ-4, REQ-5 | integration | S8 (with S6); duplicate rejection in S3 |
| AC-10 | REQ-4 | integration | S7 + S10 |
| AC-11 | REQ-6 | integration | S10 (with S6) |
| AC-12 | REQ-6 | integration | S10 (with S6) |
| AC-13 | REQ-7 | integration | S8 |
| AC-14 | REQ-8 | e2e flow | S18 |
| AC-15 | REQ-8 | unit (client) | S15 |
| AC-16 | REQ-9 | unit (client) | S15 (with S6) |
| AC-17 | REQ-10 | unit (client) + integration | S14 + S8 |
| AC-18 | REQ-11 | integration | S10 |
| **AC-19** | **REQ-11** | **unit** | **S7 (mechanism, + R3) + S10 (call site)** |
| AC-20 | REQ-12 | integration | S10 |
| AC-21 | REQ-12 | integration | S10 |
| AC-22 | REQ-13 | integration | S7 + S10 |
| AC-23 | REQ-14 | integration | S10 |
| AC-24 | REQ-14 | unit (client) + e2e flow | S17 + S18 |
| AC-25 | REQ-14 | unit (client) | S17 |
| **AC-26** | **REQ-3, REQ-10** | **integration** | **S7 (`sectionTokens`) + S10 (recording line)** |
| AC-27 | REQ-10, REQ-13 | integration | S7 + S8 + S10 |
| AC-28 | REQ-10 | unit (client) | S14 |
| AC-29 | REQ-10 | unit (client) | S15 |
| AC-30 | REQ-6, REQ-10 | unit (client) + integration | S14 + S8 |
| AC-31 | REQ-10 | integration | S8 + S10 |

All 31 covered, every one with a step. AC-26's covering step is now writable because BQ-1/(a) supplies the recorded value it asserts against.

---

## Execution — single-agent pass *(not chosen; recorded for comparison)*

One `implementer` runs S1 → S19 in order with gates interleaved:

S1 → `diff -rq` → S2 → S3 → `db:generate && db:migrate` → S4 → S5 → `vitest related` → S6 → S7 → `vitest related` → S8 → S9 → server typecheck + unit suite → S10 → integration suite → S11 → S12 → S13 → S14 → S15 → S16 → client typecheck + `pnpm test` → S17 → S18 → S19. Then `plan-verifier` re-runs the verification table; `architecture-reviewer` grades the settled diff.

**Honest cost:** fully serial. Nineteen steps across three packages, two protected-zone entries, a generate/migrate cycle, and a Dockerised integration suite. The client tail (S11–S18) is roughly 40% of the work and shares no files with the server core, so a single agent pays that wall-clock for nothing. The longest unavoidable stretch is S5–S10, which genuinely cannot be parallelised.

## Execution — multi-agent run — **CHOSEN MODE**

| Track | Steps | Agent | Model | File set | Starts after | Brief |
|---|---|---|---|---|---|---|
| **T0 Contract** | S1, S2 | `implementer` | **opus** | `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `server/src/modules/project-context/contract.ts`, `server/test/contracts.test.ts`, `server/test/project-context-contract.test.ts` | — | Add three optional fields to `SpecFile` (**no `tokens_exact`**), mirror byte-identically to the client copy, prove `diff -rq` prints nothing. Declare the module-local `Attachment`/`Projection` schemas. You are in a do-not-touch zone: do not edit the barrel, do not touch any other contract file. **Opus** — a wrong shape here propagates into every other track. |
| **T1 DB** | S3 | `implementer` | **opus** | `server/src/db/schema/context.ts`, `server/src/db/migrations/0014_*.sql` (generated), **`server/test/project-context-schema.it.test.ts`** | T0 | Append the table with R1's two nullable FKs and the `num_nonnulls = 1` check, **and two partial unique indexes — not a four-column unique index, which Postgres would satisfy with two rows both carrying `skill_id = NULL`**. Then `db:generate` → `db:migrate`. Write the constraint test that inserts a duplicate and expects failure. Never hand-write SQL; never edit an existing migration. **Opus** — tenancy, cascade and uniqueness semantics live here. |
| **T2 Server core** | S4–S10 | `implementer` | **opus** | `server/src/modules/project-context/**`, `server/src/modules/index.ts`, `server/src/modules/reviews/run-executor.ts`, `server/test/project-context-*.test.ts`, `server/test/project-context.it.test.ts`, `server/test/reviews.it.test.ts`, `server/test/prompt-log.test.ts`, `server/test/routes-smoke.test.ts` | T1 | Discovery with symlink-skip + `realpath` containment, the shared assemble module with `sectionTokens`, repository/service, routes, registry, run injection and the `sectionTokens` log line. **Deliberately one track:** `assemble.ts` is called by both the projection route and `run-executor`, and AC-26/AC-27 assert those two agree *exactly* — splitting them across agents makes the single guarantee this feature sells the most likely thing to break. **Opus** throughout: security gate, tenancy, budget arithmetic, AC-19. |
| **T3 Client foundation** | S11, S12, S13, S14 | `implementer` | **sonnet** | `client/src/lib/hooks/project-context.ts`, `client/src/lib/hooks/index.ts`, `client/messages/en/context.json`, `client/messages/en/agents.json`, `client/src/vendor/ui/nav.ts`, `client/src/components/ProjectionSummary/**` | T0 | Hooks over `lib/api.ts` with locally-declared envelopes, i18n (rewrite `empty.body`; leave superseded keys), one nav entry, and the cross-route `ProjectionSummary` — a **pure render of the server payload that computes no totals**. Do not touch `core.ts`. `styles.ts` not Tailwind; `.tnum` on numbers; `Badge` + local `*_META` for origin/outcome as words; `fireEvent` never `userEvent`. **Sonnet** — no decision propagates from here; every number arrives from the server. Runs in `client/` concurrently with T1/T2 in `server/`. |
| **T4 Client UI** | S15, S16 | `implementer` | **sonnet** | `client/src/app/context/**`, `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx}`, `.../AgentEditor/_components/ContextTab/**`, `.../AgentEditor/AgentEditor.test.tsx` | T2, T3 | Build the `/context` page and the read-only `AgentEditor` Context tab, both consuming `ProjectionSummary` from T3 and the S8 projection endpoint. **`AgentEditor.tsx:24`'s two-way ternary must become a map or switch** before adding a third tab. `useActiveRepo` for the repo; no refresh affordance (D-7). `fireEvent` never `userEvent`. **Sonnet** — the hard arithmetic is server-side. |
| **T5 Trace tests** | S17 | `implementer` | **sonnet** | `.../RunTraceDrawer/_components/TraceBody/TraceBody.test.tsx` | T4 | Tests only, against **unmodified** source. If a test needs a source change, report it — do not make it. **Sonnet.** Sequenced after T4 rather than beside it because both write to `client/`. |
| **T6 e2e + fixture** | S18, S19 | `implementer` | **sonnet** | `e2e/specs/08-project-context.flow.json`, `server/test/fixtures/context-clone/**`, `server/src/db/seed.ts`, `server/INSIGHTS.md`, `client/INSIGHTS.md` | T5 | Build the fixture clone (include `server/docs/…` — the non-leading segment proving D-2a and the video's money shot; **no `node_modules/` case, it is gitignored**), point `seed.ts:96` at it, seed two attachments, write flow `08`. Never trigger a review run — that is how the no-LLM rule is met structurally. Then append INSIGHTS. **Sonnet.** |
| **R1 Verify** | — | `plan-verifier` | opus | read-only | T6 | Re-run the whole verification table once, including `reviewer-core` typecheck (proving it was untouched) and `diff -rq` for vendor parity. |
| **R2 Review** | — | `architecture-reviewer` | opus | read-only | T6 | Grade the settled diff. Named focus: the traversal guard (S5), the AC-19 call site (S10), and the R1 cascade design (S3). |

**Where the `AgentEditor` Context tab landed, and why.** S16 goes in **T4 with the `/context` page**, not in its own track. Its file set is disjoint from S15's, so a separate track was tempting — but both are writers in `client/`, and the rule is that parallel writers in one package need worktree isolation or must be sequenced. Sequencing two tracks buys no wall-clock over merging them, and costs an extra invocation and an extra brief. Merging also buys something real: one agent owning both surfaces guarantees the projection renders identically in both, which is the whole point of putting `ProjectionSummary` in `client/src/components/` in T3. The alternative — folding S16 into T3 — was rejected because T3 is the foundation track and must finish before any UI consumes it.

**Barriers:**
1. **Contract barrier (T0).** `server/src/vendor/shared/` plus its client mirror must land and `diff -rq` must print nothing before T1, T2 or T3 start. Global, non-negotiable.
2. **DB barrier (T1).** Schema edit → `db:generate` → `db:migrate` is one indivisible serial unit. T2 cannot start until the migration is applied, **and its constraint test must pass before T2 builds on the table**.
3. **Registry line.** `server/src/modules/index.ts` belongs to **T2 exclusively**. No other track touches it.
4. **`run-executor.ts`** belongs to **T2 exclusively** — the shared studio+CI path and the AC-19 carrier.
5. **`server/src/db/seed.ts`** belongs to **T6 exclusively**, and T6 runs when no other server track is live.
6. **`ProjectionSummary` barrier.** T3 must land it before T4 starts; T4 consumes it and does not redefine it.
7. **Review gate.** R1 and R2 start only after T6 completes. They never run alongside a writer.

**Worktree isolation needed: no.** As decomposed, no two concurrent tracks write to the same package. T0 → T1 → T2 are strictly sequential in `server/`; T3 runs in `client/` concurrently with T1/T2; T4 → T5 → T6 are sequenced within `client/` (and T6's `server/` files are touched when no server track is live). The one place isolation would buy something is running T5 beside T4 — T5 is the cheapest track to move if you want that, and it is genuinely independent.

**Chosen mode: multi-agent.** The deciding factor is that the server core is genuinely indivisible (one `assemble.ts` feeds both the projection and the run, and AC-26/AC-27 assert they agree exactly), while T3's client foundation overlaps T1/T2 for free in a different package. The decomposition parallelises exactly what is separable and refuses to split what is not.

## Cost envelope

| Mode | Agent invocations | Model tiers | What dominates the cost |
|---|---|---|---|
| single-agent | **5** — 1 `implementer` (S1–S19) + 1 `plan-verifier` + 1 `architecture-reviewer` + 2 budgeted fix rounds | opus throughout (one agent inherits the session model) | One long opus session carrying 19 steps across three packages, re-reading both `CLAUDE.md` files and all four `INSIGHTS.md`. Wall-clock, not invocation count, is the real cost. |
| **multi-agent (chosen)** | **11 — unchanged by the cross-review amendments** — 7 `implementer` tracks (T0–T6) + 1 `plan-verifier` + 1 `architecture-reviewer` + 2 budgeted fix rounds | **3 opus** (T0, T1, T2) + **4 sonnet** (T3–T6) + 2 opus reviewers | **T2 dominates** — seven steps of opus work and roughly two-thirds of the diff. The four sonnet tracks are cheap; the saving comes from not running them on opus and from T3 overlapping T1/T2 across package boundaries. Per-track briefs rather than the full plan are what keep 7 invocations from costing more than the tests do. |

**Counted, not estimated:** 19 steps → 7 implementer tracks, + 2 reviewers, + 2 fix rounds = **11**. Set `--max-agents` at 11 or above. The BQ-2/(b) client work did **not** raise the track count, because S16 was merged into T4 rather than given its own track. **The three cross-review amendments add one test file to T1's file set and clauses to five existing steps; no step moved tracks, no track was added, and the agent count is unchanged.** If a lower ceiling is forced, the smallest honest collapse merges T5 into T4, giving **10**; below that, merge T3 into T4 for **9**, at the cost of serialising the only cross-package overlap in the plan.

## Risks & open questions

- **The skill half of the reviewer's feedback is deliberately not built.** The course reviewer's returned feedback named "no Context tab in the agent **and skill** editors". BQ-2/(b) builds the **agent** half only. The skill half was considered and left out because `SkillEditor` (`client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx`) has **no tab bar at all** — it is a single component, so a Context tab there means first designing and building a tab shell for that screen, which is its own change with its own review surface. The spec supports this reading: REQ-8 puts both tabs on `/context`, and §14's open question is phrased about the **agent** editor only ("Should an agent's own editor show its attached documents read-only?"). **That §14 question is now answered for agents and remains open for skills.** This is a decision, not an oversight; a reader or reviewer finding no skill-editor Context tab should find this paragraph rather than infer a miss.
- **F1 residual — the CHECK and the indexes are now two halves of one rule.** The partial indexes make uniqueness independent of `num_nonnulls`, which is why they were chosen; but a future change that adds a third target kind must add a third partial index, and nothing in the schema will remind anyone. S19 records this pairing in `server/INSIGHTS.md` for exactly that reason.
- **F2 residual — we import another module's list.** `CONTEXT_DOC_DIR_SEGMENTS` is `REFERENCE_DOC_DIRS`, owned by `intent`. Implementing both predicates means `.devdigest/specs/` survives a change to that list, and S5's isolated prefix test fails loudly if the prefix branch is removed. What is *not* protected: if `intent` drops `docs` or `plans`, this feature's discovery narrows silently. Settling that would mean owning our own copy of the segment list — deliberately not done, because D-2 says "reusing `REFERENCE_DOC_DIRS`" and duplicating it invites the two lists to diverge.
- **F3 residual — three clone states, and only two are in the spec.** AC-2 names `not_cloned`; §6 names "Clone unreadable". `clone_missing` sits between them and is decided here, reaching AC-2's outcome with a distinguishable reason. If a product owner would rather a deleted clone surface as an error, S12's copy and S15's rendering are where that changes — the server contract already distinguishes the case.
- **Assumption A1 — the `## Project context` literal is duplicated.** `reviewer-core` must not change and exports neither the heading string nor the `\n\n` join, so S7 restates two literals that `prompt.ts:132` owns. If the engine ever changes its heading, the projection silently drifts. Mitigation: the AC-26 integration test is the mechanical detector — a further argument for BQ-1/(a). No way was found to avoid the duplication without touching `reviewer-core`, which is out of scope.
- **Assumption A2 — `buildPartialTrace`'s `specs_read: []` (`run-executor.ts:557`) stays empty.** That trace is built for failed and cancelled runs at a point where no document has been resolved, so there is nothing to list. REQ-14 speaks about the trace of a run that happened. If REQ-14 is read as covering failed runs too, this becomes a new blocking question.
- **Assumption A3 — no exactness signal for token counts.** `TiktokenTokenizer.broken` is private and the `Tokenizer` interface exposes only `count`. R2 omits `tokens_exact`; AC-8 requires the estimate label unconditionally, so nothing observable changes.
- **Fixture-vs-gitignore.** Verified: `git check-ignore -v server/test/fixtures/context-clone/node_modules/pkg/docs/x.md` resolves to `.gitignore:1`. AC-3's excluded-directory case therefore cannot be committed and lives in S5's temp-dir unit test. If a future reader "fixes" the fixture by adding a `!` negation to the root `.gitignore`, they will have widened a repo-wide rule to serve one test — don't.
- **Spec line references have drifted.** `isSafeRepoPath` is at `intent/references.ts:78`, not `:58-66`; the trace drawer lives under `pulls/[number]/`, not `pulls/[prId]/`; and §3's "no brief module is registered" is now false. None changes a decision, but an implementer navigating by the spec's line numbers will miss. **The plan's own citations are what was verified — prefer them.**
- **Could not verify:** the 2 s discovery latency for 500 documents and the sub-500 ms run-injection budget (§7) — both need a real clone at scale. What would settle them: time S5's walk against this repository's own clone, which the T2 implementer can do as part of S5.
- **`agent_skills` carries no `workspace_id`**, so it is a precedent for the *ordering* model only, never the tenancy model. REQ-7 and the house rule both require `workspace_id` on the new table. Do not copy it wholesale.
- **R5, recorded so it is not "finished":** `useReindexContext` (`client/src/lib/hooks/core.ts:132-138`) posts to `/context/reindex`, a route this feature deliberately does not create (D-7). It stays unwired and undeleted. Likewise the superseded `context.json` keys.

## Handoff

- **Read first:** `server/specs/project-context/01-project-context.md` (binding), then `server/INSIGHTS.md` and `client/INSIGHTS.md`, then `reviewer-core/src/prompt.ts` (lines 97–167 — the contract S7 and S10 must match) and `server/src/modules/reviews/run-executor.ts` (lines 200–300 and 370–390 — the injection site and the AC-19 idiom).
- **Security reference for S5:** `server/src/modules/repo-intel/pipeline/walk.ts` (the walk to copy, symlink skip at `:89`) and `server/src/adapters/git/simple-git.ts` lines 142–143 (the uncontained read that makes S5's gate necessary).
- **Schema reference for S3:** `server/src/db/schema/context.ts` (the append target) and `server/test/helpers/pg.ts` (the PG16 pin behind F1's choice).
- **Client patterns for S14–S16:** `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyRiskCard/` (`FileRef`/`FocusRow` truncation + `srOnly`, and `constants.ts`'s `RISK_META` band-as-a-word pattern).
- **Not reviewed here:** architecture and security review are separate agents. The traversal surface is flagged, not reviewed.
- **Execution mode is settled: multi-agent, 7 implementer tracks, 11 total invocations.** Every blocking question is answered and every recommendation decided, so `/impl` can start at T0 with no further input.
