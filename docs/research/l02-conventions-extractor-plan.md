# Plan — L02: Conventions Extractor + API Contract Reviewer

Survey and plan, 2026-08-02. Nothing built yet.

---

## 1. Baseline — more is done than the brief assumes, and one thing less

Measured, not guessed.

### Already there

| Piece | Where | State |
|---|---|---|
| `conventions` table | `db/schema/knowledge.ts:31` | in DB, 0 rows |
| `skills` + `skill_versions` | `db/schema/skills.ts` | in DB, 0 rows |
| `agent_skills` link table | `db/schema/agents.ts:51` | in DB, 0 rows |
| **Agent ↔ skill link API** | `modules/agents/routes.ts:145` | `GET`/`POST /agents/:id/skills` — works |
| **`getConventionSamples()`** | `modules/repo-intel/service.ts:630` | implemented |
| Conventions model slot | `modules/settings/feature-models.ts` | wired, with a dynamic default |

The `skills` table is richer than the brief needs: `type` (rubric/convention/security/custom),
`source` (**manual/imported_url/extracted/community**), `version`, `evidenceFiles`, plus a
`skill_versions` history table. `source: 'imported_url'` is exactly the import path the
brief asks to exercise.

### Missing

| Gap | Consequence |
|---|---|
| No `modules/skills/` | **A skill cannot be created at all** — no CRUD routes |
| No `modules/conventions/` | No extract route |
| No `/skills`, `/conventions` client routes | `activeKeyFor()` already maps them, so the sidebar links exist and lead nowhere |
| No extraction prompt | `prompts/` holds only `onboarding.system.md` |

### The blocker the brief does not mention

`modules/reviews/run-executor.ts:429`

```ts
prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' }
```

**Linked skills never reach the review prompt.** `skills` is hard-coded `null`, and no other
file in `modules/reviews/` mentions skills.

So the agent↔skill link API works, the UI could link four skills, and the prompt sent to
the model would be **byte-identical** to the no-skills run. The Part 2 experiment would
show "no difference" and read as *skills don't help*, when the real cause is that they were
never sent.

**This is the first thing to fix.** Everything else in Part 2 depends on it, and it is the
kind of failure that looks like a negative result instead of a bug — the same shape as the
empty-diff review already recorded in `server/INSIGHTS.md`.

---

## 2. Part 1 — Conventions Extractor

### 2.1 Schema decision needed

The `conventions` table is:

```
id · workspaceId · repoId · rule · evidencePath · evidenceSnippet · confidence · accepted
```

Two mismatches with the brief and the acceptance criteria:

- **No `category`.** The brief asks the model for `{категорія, правило, evidence, впевненість}`.
- **No line numbers.** Acceptance requires *"клік веде до файла з кодом на GitHub"* — a deep link needs `#L23-L31`.
- **No tri-state.** `accepted: boolean` cannot distinguish *pending* from *rejected*; the UI needs three states, and rejected candidates must be excluded from the skill.

Options:

- **A. Migration** — add `category text`, `start_line int`, `end_line int`, change `accepted` to `status text('pending'|'accepted'|'rejected')`. Clean, and `db:generate` handles it.
- **B. No migration** — encode `"src/api/users.ts:23-31"` in `evidencePath`, put category in the rule text, keep `accepted` boolean and delete rejected rows.

**Proposal: A.** The design mock shows `src/api/users.ts:23-31` as a distinct field, tri-state is genuinely needed for the accept/reject UI, and the column is what makes the GitHub deep link reliable rather than parsed out of a string.

### 2.2 Pipeline

Four stages, only one of which is a model call.

1. **Sample selection — pure code, no model.**
   - Configs verbatim: `eslint.config.*`, `.eslintrc*`, `tsconfig.json`, `.prettierrc*`, `package.json` scripts.
   - Top-12 source files from `repoIntel.getConventionSamples(repoId, 12)` (PageRank-ranked, already implemented).
   - Budget the payload with the existing tokenizer adapter — the model call must not blow the context on one large file.

2. **Model call** — cheap model from the conventions feature-model slot. Returns candidates:
   `{ category, rule, evidencePath, startLine, endLine, snippet, confidence }`.
   Structured output via the existing `platform/structured.ts`.

3. **Evidence verification — pure code.** For each candidate:
   - file exists in the clone?
   - line range exists?
   - **the snippet actually appears at those lines?**
   Candidates failing any check are dropped, and the drop count is reported — that number is the honest quality metric for the write-up.

   The third check is the one that matters. File-and-line existence is easy to satisfy by accident; matching the snippet is what proves the model did not invent the evidence. This is the same grounding gate the review pipeline already uses.

4. **Persist** surviving candidates as `status: 'pending'`.

`POST /repos/:id/conventions/extract` → runs 1–4, returns the candidates plus
`{ proposed, verified, dropped }`.

### 2.3 Skill assembly

`POST /repos/:id/conventions/skill` takes accepted ids → renders one markdown body →
creates a `skills` row with `type: 'convention'`, `source: 'extracted'`,
`evidenceFiles: [...]`, `version: 1`.

Rejected and pending candidates are excluded by construction — the route filters on
`status = 'accepted'` rather than trusting the client's list.

Body shape follows the design mock:

```md
# payments-api-conventions
House conventions for `payments-api`. Flag changes that violate any rule below
and cite the offending `file:line`.

## async-await-then-chains
Always use async/await instead of .then() chains.
Detected in `src/api/users.ts:23-31`:
```

### 2.4 UI

Two routes, matching the design drop `(3)`:

- `/conventions` — candidate list, per-card Accept/Reject, select-all, "Create skill" → modal. The new design has this as a **selection model** (`conventionsToDraft(accepted)` → `CreateSkillModal`), not the old static buttons.
- `/skills` — card grid + detail. **Scope decision needed** (see §5): the drop `(3)` design specifies five tabs (Config/Preview/Evals/Stats/Versions); only Config and Preview are needed for this homework.

Evidence links: `https://github.com/{full_name}/blob/{sha}/{path}#L{start}-L{end}`.

---

## 3. Part 2 — API Contract Reviewer

### 3.1 Prerequisite: inject skills into the prompt

Fix `run-executor.ts` to load the agent's ordered skills and compose them into the system
prompt, and populate `prompt_assembly.skills` so the Run Trace shows what was actually sent.
Without this the experiment cannot produce a result.

The trace field already exists and is set to `null` — filling it makes the experiment
*visible*, which matters for the demo video.

### 3.2 The four skills

Authored as DevDigest skills (rows in `skills`), each with a directive rule plus a
good/bad example:

| Skill | Catches |
|---|---|
| `breaking-change` | removing or renaming a public route, param or field |
| `response-schema` | response shape changes — type, nullability, required-ness |
| `semver-discipline` | which changes force a major bump |
| `deprecation-policy` | marking deprecated instead of silently deleting |

At least one created via `source: 'imported_url'` to exercise that path, per the brief.

### 3.3 The experiment

Needs a PR that renames a response field or changes a route signature. Two candidates:

- **Craft one in `sergyinfo/lca-normalization-engine`** — a real repo already imported, with a real API surface.
- **Craft one in this repo** — e.g. rename a field in a `vendor/shared/contracts` response type, which is a genuine breaking change across two vendored copies.

Run the agent twice on the same PR: skills unlinked, then linked. Capture both Run Traces —
with `prompt_assembly.skills` populated, the diff between the two runs is self-evidencing.

**Honest risk:** the result is not guaranteed. A good base prompt may already catch a
blatant rename. To make the experiment meaningful the PR should contain a *subtle* contract
change — an optional field becoming required, or a nullable one becoming non-nullable —
which generic review reliably misses and a dedicated skill reliably catches.

---

## 4. Sequencing

Each step ends somewhere demonstrable.

| # | Step | Why here |
|---|---|---|
| 1 | Skills into the review prompt + trace | Unblocks Part 2; smallest change with the largest consequence |
| 2 | `modules/skills` CRUD | Nothing can be created without it |
| 3 | Migration: category, line range, status | Before any extraction writes rows |
| 4 | Conventions extract pipeline (4 stages) | The core of Part 1 |
| 5 | `/conventions` UI — list, accept/reject, create-skill modal | Part 1 demo-able |
| 6 | `/skills` UI — grid + config/preview | Part 1 complete |
| 7 | Author the 4 API-contract skills, one via URL import | Part 2 content |
| 8 | Craft the contract-breaking PR, run the A/B, capture traces | Part 2 result |
| 9 | PR description + quality report on extractor findings | Acceptance |

Steps 1–2 are worth doing regardless of how far the rest goes.

---

## 5. Open decisions

**1. Schema migration (§2.1) — A or B?** Proposal **A**: add `category`, `start_line`,
`end_line`, and a tri-state `status`.

**2. How much of the `/skills` screen?** Design drop `(3)` specifies five tabs. Proposal:
**Config + Preview only**, which covers every acceptance criterion; Evals/Stats/Versions are
later lessons.

**3. Which repo for the experiment PR?** Proposal: **this repo** — a contract change in
`vendor/shared` is genuinely breaking, easy to craft subtly, and needs no external setup.

**4. Where do the four API-contract skills live?** They must be DevDigest skill rows to be
linkable. Proposal: **author them as DB rows**, and also commit their markdown under
`docs/agent-prompts/` so they are reviewable in git.

**5. Scope of this session.** The full brief is large. Proposal: **steps 1–6 first**
(Conventions Extractor working end to end), then Part 2 as a separate pass.

---

## 6. What I cannot do

- **The demo video.** Both acceptance criteria require it; screenshots are the most I can produce.
- **Creating the agent "через UI"** — I can create it via the API, but if the video needs to show UI creation, that is yours.
- **Guaranteeing the A/B shows a difference.** §3.3 explains how to make it likely; it is an experiment, not a scripted outcome, and reporting it honestly either way is part of the deliverable.
