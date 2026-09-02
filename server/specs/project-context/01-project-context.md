---
module: server/project-context
spec: 01-project-context
status: approved
updated: 2026-08-27
supersedes:
lesson:
issue:
pr:
e2e-flow: e2e/specs/08-project-context.flow.json (to add)
design: client/specs/DevDigest Design (standalone) (3).html — inspected by decoded bundle extraction; file:// is blocked in the browser tool
---

# Spec: Project Context — attach repo markdown to agents and skills

## 1. Problem & outcome

A reviewing agent has no way to be told what the project is *supposed* to do. The prompt
already carries the diff, the repo skeleton, the callers and the derived intent, but the
PRDs, tech specs and acceptance criteria sitting in the repository never reach the model —
`reviewer-core` has rendered a `## Project context` section from a `specs` input since it was
written (`reviewer-core/src/prompt.ts:132`), and the server has never passed anything to it
(`server/src/modules/reviews/run-executor.ts:267-296`).

Solved means: a user can see the markdown documents in the connected repository with an
estimated token cost, attach chosen documents to specific agents and skills, see for a given
agent the projected token cost a run would actually send — including documents inherited from
its enabled skills, and which documents would be dropped for budget — and, after a run, open
the Prompt Assembly view and read the exact project-context text that was sent, including
which attached documents were skipped and why.

## 2. Users & triggers

The DevDigest studio user, working locally in a single workspace.

- **Discovery trigger:** opening the Project Context page for the currently selected repo.
- **Attachment trigger:** the user toggling a document onto an agent or a skill.
- **Projection trigger:** an agent being brought into view — selecting it on the Agents tab —
  which is what produces a projected total and the would-be-dropped marking. With no agent in
  view there is no projection (D-11).
- **Injection trigger:** an agent review run starting — `runOneAgent`
  (`run-executor.ts:201`), on both the studio path and the CI path that shares it.

## 3. Scope

**In scope**

- Discovering markdown documents in allow-listed documentation directories of the connected
  repository's local clone.
- A per-document estimated token count, and a per-agent projection of the token cost a run
  would send, against the section budget.
- Attaching documents to agents and to skills, in a user-controlled order.
- Reading attached documents at run start and injecting them as untrusted project context.
- Surfacing the injected text, and every skipped document, in the existing Prompt Assembly view.
- A per-document and per-skill **usage count** — a number only.
- Replacing the shipped empty-state copy, which describes a different attachment model.

**Out of scope — already ships, do not rebuild**

- Rendering the project-context prompt section. `reviewer-core/src/prompt.ts:106-108` wraps
  each entry as `<untrusted source="spec-N">` and `:132` renders `## Project context`;
  `:154` populates `assembly.specs`. Per `reviewer-core/INSIGHTS.md` (2026-08-17), the
  four-file "add a prompt section" recipe is **already complete** for `specs` —
  **`reviewer-core` needs no change at all.**
- The prompt-injection defence for this content. `INJECTION_GUARD`
  (`reviewer-core/src/prompt.ts:16-28`) already names untrusted blocks as data, and
  `wrapUntrusted` (`:30-34`) already neutralises `</untrusted>` escapes.
- The openable full-text viewer. `PromptBlock`
  (`client/.../RunTraceDrawer/_components/PromptBlock/PromptBlock.tsx:23-63`) is collapsible
  with copy and fullscreen controls; `TraceBody.tsx:85-87` already renders it for
  `prompt_assembly.specs` under the label "Project context (dynamic)"
  (`client/messages/en/runs.json:50`).
- The "Specs read" list in the trace drawer — `TraceBody.tsx:39-51`, with a "none" empty state.
- **Per-run preservation of the sent text.** `run_traces.trace` is a single jsonb document
  (`server/src/db/schema/runs.ts:37-42`) containing the whole `prompt_assembly`.
- A token counter — `container.tokenizer` (`server/src/platform/container.ts:134`), backed by
  `TiktokenTokenizer` with an `approxTokens` fallback (`adapters/tokenizer/index.ts:25-40`).
- The `SpecFile` and `IndexStatus` contracts (`contracts/platform.ts:259-274`).
- The sidebar label "Project Context" (`shell.json:20`) and the `/context` → `context`
  active-key mapping (`client/src/components/app-shell/helpers.ts:30`).
- The attach interaction primitives — `Toggle` with `role="switch"`
  (`vendor/ui/primitives/Toggle.tsx:15`), `Tabs` with per-tab counts (`vendor/ui/kit/Tabs.tsx`),
  and the ordered-link model `agent_skills` (`db/schema/agents.ts:51-63`) with its copy
  "Order matters — earlier skills appear earlier in the assembled prompt. Toggle to attach."
  (`agents.json:94`).
- The rule that a **disabled** skill never reaches the model, enforced in SQL
  (`reviews/repository/skill.repo.ts:22`).

**Out of scope — deliberately not built**

- Editing, creating, renaming or deleting documents. **View-only** (D-5).
- Document version history, pinned snapshots as separate records, version diffing (D-8).
- Indexing, embedding or chunking of markdown; no Re-index button and no index status. The
  design's chunk count is **replaced** by a tokens total rather than simply dropped (D-7).
- Repo-wide markdown discovery (D-2).
- PR-brief consumption. The shipped copy claims "the PR brief" reads these documents
  (`context.json:13`); no brief module is registered (`server/src/modules/index.ts:29-43`).
- Usage graphs, per-run usage history, last-used timestamps (D-3).
- Any change to `reviewer-core`, and any change to the `RunTrace` contract.

## 4. Requirements

| ID | Requirement | Rationale | Status today |
|---|---|---|---|
| REQ-1 | For the selected repo, the server returns every discovered markdown document with its repo-relative path, byte size and last-modified time, read live from that repo's local clone on each request. | Requirement 1 — discover what exists. | absent — `GET /repos/:id/context` is already called by `client/src/lib/hooks/core.ts:126`, but no such route is registered (`server/src/modules/index.ts:29-43`) |
| REQ-2 | Discovery includes a file only when its extension is `.md`/`.mdx` **and** some segment of its path is an allow-listed documentation directory (`docs`, `doc`, `specs`, `spec`, `plans`, `plan`, `rfcs`) or it sits under `.devdigest/specs/`; excluded directories are never walked; any path escaping the repo root is refused; any file over the per-document cap is listed but not attachable. | D-2. A traversal bug here reads arbitrary host files into a prompt. | absent — the pieces exist for other callers: `REFERENCE_DOC_DIRS` (`intent/constants.ts:6`), `isSafeRepoPath` (`intent/references.ts:58-66`), `EXCLUDED_DIRS` (`repo-intel/constants.ts:17-26`) |
| REQ-3 | Each discovered document carries an **estimated** token count from the server's existing tokenizer, and the UI labels it as an estimate rather than an exact count. One counter produces the displayed per-document estimate, the projected total (REQ-10) and the budget-enforcement decision (REQ-13), so the three can never disagree. | Requirement 3, made honest — NFR-2. Consistency is the property that is testable; absolute accuracy is not (§14). | partial — counter exists (`container.ts:134`); `SpecFile` has `size` but no token field (`contracts/platform.ts:260-265`) |
| REQ-4 | A user can attach a document to an agent and detach it, with a user-controlled order. | Requirement 2, Agents tab. | absent — no attachment table in any file under `server/src/db/schema/` |
| REQ-5 | A user can attach a document to a skill and detach it, with the same ordering. | Requirement 2, Skills tab. | absent |
| REQ-6 | A document attached to a skill reaches every agent that has that skill **linked and enabled**; a disabled skill contributes none of its documents. | D-6, mirroring the SQL-enforced rule that a disabled skill never reaches the model. | absent — the enabled filter exists for skill bodies at `reviews/repository/skill.repo.ts:22` |
| REQ-7 | Every attachment records the workspace and the `repo_id` of the document it points at; a request for another workspace's attachment returns 404. | D-6 (cross-repo) and the house rule that every domain table carries `workspace_id`. | absent |
| REQ-8 | The Project Context page lists discovered documents and offers a **Skills** tab and an **Agents** tab for attaching them, reachable from a sidebar entry at `/context`. | Requirement 2. | absent — no route under `client/src/app/`; `vendor/ui/nav.ts:21-36` has no `context` item |
| REQ-9 | Each document row shows how many agents use it (directly or via an enabled linked skill); each skill row shows how many agents have that skill linked. A count only. | D-3. | absent |
| REQ-10 | For an agent in view, the page shows the **projected** project-context token total a run would actually send — the agent's direct attachments plus those inherited from its **enabled** linked skills, including each document's `<untrusted>` wrapper and the section heading — as a fraction of the 8 000-token budget, and visibly marks the documents that **would be dropped** for budget before any run. The projected number and the section size recorded for a run with the same configuration and unchanged files must agree. With no agent in view, per-document estimates are shown and no total or fraction is displayed. On the Skills tab, a skill shows a **contribution** figure (its documents plus wrapper) with no budget fraction and no drop marking. | D-4, D-9, D-10, D-11. A sum of selected rows understates the true cost three ways — skill-inherited documents, wrapper and heading overhead, and budget elision — so it answers a question the user is not asking. | absent |
| REQ-11 | When an agent run starts, the documents attached to that agent — plus those attached to its enabled linked skills — are read from the clone and passed to the review engine as project context, agent-direct first, then per skill, each in attachment order. | Requirement 4. | partial — the engine consumes and renders it (`prompt.ts:132`, `review/run.ts:139`); the server passes nothing (`run-executor.ts:267-296`) |
| REQ-12 | An attached document that is missing, unreadable, empty, over the per-document cap, or belongs to a different repo than the one under review is skipped; the run continues and completes normally. | D-2 (cross-repo), and the house best-effort rule. | absent |
| REQ-13 | When the combined project-context text exceeds the section budget, whole documents are dropped from the end of the order — never truncated mid-document — and each dropped document is recorded exactly as a skip is. | D-4. Truncation can remove a "must not" clause and invert a spec's meaning. | absent |
| REQ-14 | The run trace's `specs_read` lists **every** attached document — injected ones by path, skipped and dropped ones by path plus a human-readable reason — the run log records one line per skipped or dropped document, and the Prompt Assembly view shows a "Project context" entry that opens to the full injected text for that run. | Requirement 5 and D-1. | partial — both already render (`TraceBody.tsx:85-87`, `:39-51`); they are permanently empty because `specs_read: []` is hardcoded at `run-executor.ts:382` and `:557` |

**Two different numbers appear on a document row, and they must not be confused.** REQ-9's
usage count is *how many agents use this document*; REQ-3's estimate and REQ-10's projection
are *what it costs in tokens*. The usage count is a property of the document across the
workspace; the projection is a property of one agent. Label them so that neither can be read
as the other.

## 5. Acceptance criteria

| ID | Covers | Given / When / Then | Verified by |
|---|---|---|---|
| AC-1 | REQ-1 | Given a clone containing `docs/a.md` and `server/docs/b.md` / When the list is requested / Then both appear with path, byte size and modified time. | integration |
| AC-2 | REQ-1 | Given a repo whose `clone_path` is null / When the list is requested / Then an empty list with an explicit "not cloned" reason, not a 500. | integration |
| AC-3 | REQ-2 | Given a clone containing `README.md` at the root, `src/notes.md`, and `node_modules/pkg/docs/x.md` / When the list is requested / Then none of the three appears. | unit |
| AC-4 | REQ-2 | Given `.devdigest/specs/prd.md` / When the list is requested / Then it appears. | unit |
| AC-5 | REQ-2 | Given an attachment path of `../../../etc/passwd`, an absolute path, or one containing a null byte / When it is attached or read / Then it is rejected with 422 and never opened. | unit |
| AC-6 | REQ-2 | Given a 2 MB markdown file in `docs/` / When the list is requested / Then it is listed, marked over-cap, and cannot be attached. | integration |
| AC-7 | REQ-3 | Given a document / When the list is requested / Then it carries a positive integer token estimate, and a repeat request yields the same number. | unit |
| AC-8 | REQ-3 | Given a token estimate is displayed / When the row renders / Then an approximation marker accompanies it and no copy claims the number is exact. | unit (client) |
| AC-9 | REQ-4, REQ-5 | Given a document and an agent / When attached, then re-fetched / Then the attachment is present with its order; when detached, it is absent. | integration |
| AC-10 | REQ-4 | Given three documents attached to an agent / When their order is changed / Then a subsequent run injects them in the new order. | integration |
| AC-11 | REQ-6 | Given a document attached to a skill that is linked to an agent and **enabled** / When that agent runs / Then the document's text appears in the project-context section. | integration |
| AC-12 | REQ-6 | Given the same setup but the skill **disabled** / When that agent runs / Then the document does not appear in the prompt, and the run is unaffected. | integration |
| AC-13 | REQ-7 | Given an attachment owned by workspace A / When requested as workspace B / Then 404, not 403. | integration |
| AC-14 | REQ-8 | Given the Project Context page / When it loads / Then discovered documents are listed and both a Skills tab and an Agents tab are present and switchable. | e2e flow |
| AC-15 | REQ-8 | Given no documents are discovered / When the page loads / Then the empty state renders rather than a blank list. | unit (client) |
| AC-16 | REQ-9 | Given a document attached to two agents / When the list renders / Then its usage count reads 2. | unit (client) |
| AC-17 | REQ-10 | Given an agent with two direct attachments and one enabled linked skill carrying a third / When the page shows that agent / Then the projected total covers all three documents plus per-document wrapper and the section heading, and renders as a fraction of 8 000. | unit (client) + integration |
| AC-18 | REQ-11 | Given an agent with one attached document / When a review runs / Then the prompt contains a `## Project context` section wrapping that document's text and the persisted `prompt_assembly.specs` is non-null. | integration |
| AC-19 | REQ-11 | Given an agent with **no** attached documents / When a review runs / Then the assembled prompt is byte-identical to one produced before this feature existed. | unit |
| AC-20 | REQ-12 | Given an attached document deleted from the clone / When a review runs / Then the run completes with a normal status and the remaining documents are still injected. | integration |
| AC-21 | REQ-12 | Given an agent whose attached document belongs to repo A / When it runs against a PR in repo B / Then that document is skipped and no same-named file from repo B is read. | integration |
| AC-22 | REQ-13 | Given attachments whose combined estimate exceeds 8,000 tokens / When a review runs / Then only whole documents are injected, the section estimate is at or under budget, and every dropped document is recorded with a reason. | integration |
| AC-23 | REQ-14 | Given the AC-20 run / When its trace is read / Then `specs_read` contains the deleted document's path with a skip reason and the run log has a line naming it. | integration |
| AC-24 | REQ-14 | Given a completed run with project context / When the trace drawer opens / Then a "Project context" block expands to the full injected text and "Specs read" lists every attachment with its outcome. | unit (client) + e2e flow |
| AC-25 | REQ-14 | Given a completed run with no project context / When the drawer opens / Then no "Project context" block renders and "Specs read" shows its "none" state. | unit (client) |
| AC-26 | REQ-3, REQ-10 | Given an agent's projected total is displayed / When a review runs for that agent with the same attachments and unchanged files / Then the project-context section size recorded for that run equals the projected number. | integration |
| AC-27 | REQ-10, REQ-13 | Given an agent whose projected total exceeds 8 000 / When the page shows that agent / Then the documents that would be dropped are visibly marked before any run, and that marked set is identical to the set the subsequent run records as dropped. | integration |
| AC-28 | REQ-10 | Given no agent is in view / When the page renders / Then per-document estimates appear, no projected total and no budget fraction appear, and the page states that choosing an agent is required to see a projection. | unit (client) |
| AC-29 | REQ-10 | Given a skill with two attached documents / When the Skills tab renders it / Then a contribution figure covering those documents plus wrapper is shown, with no budget fraction and no drop marking. | unit (client) |
| AC-30 | REQ-6, REQ-10 | Given an agent whose every linked skill is disabled / When the page shows that agent / Then the projection counts only its direct attachments, and the disabled skills' documents are shown as not contributing. | unit (client) + integration |
| AC-31 | REQ-10 | Given one document attached to agent A directly and inherited by agent B via a skill, where B is over budget and A is not / When each agent is viewed / Then the document is marked would-be-dropped for B and not for A. | integration |

## 6. States & corner cases

| Dimension | Trigger | Expected behaviour | Source |
|---|---|---|---|
| Cardinality — zero | No documents in any allow-listed directory | Empty state, with copy that names the allow-listed directories rather than only `.devdigest/specs/` | gap — decided here; replaces `context.json:11-14` |
| Cardinality — zero attachments | Agent has none | Prompt omits `## Project context` entirely; trace slot stays null | `reviewer-core/src/prompt.ts:106-109` — `specsBlock` undefined ⇒ section omitted |
| Cardinality — many | More documents than the listing cap | List up to the cap and state the list is capped | NFR-1 |
| Loading | First page load | Skeleton on the document list; tabs render immediately | gap — decided here |
| Failure | Clone unreadable | Shipped error copy `"Couldn’t load specs"`; saved attachments untouched | `context.json:9` |
| Failure | `clone_path` is null | Empty list with a "repository not cloned yet" reason, not an error toast | `db/schema/repos.ts:16` (nullable) |
| **Freshness** | **Clone is stale, so the list is missing a document the user just pushed** | The list is read live from the clone on every request, so it always matches the clone — there is nothing to invalidate. The clone itself advances only via the existing `POST /repos/:id/resync`, so the page displays the clone's last-synced time and points at that existing repo-level control. **This page adds no refresh affordance of its own.** | D-7; `server/INSIGHTS.md` 2026-08-23 (a repo can be `status: full` yet indexed from a 38-commit-old tree) |
| Freshness | Document changed on disk after its estimate was shown | The run reads the current file; the earlier estimate may be stale. No staleness badge is specified | D-8 |
| Freshness | Trace of an old run | Shows the text sent at that time from the stored trace; never re-read from disk | `db/schema/runs.ts:37-42` |
| Degraded dependency | One attached document fails to read | Skip it, continue, record it | D-1 |
| Degraded dependency | Every attached document fails | Run proceeds with no project-context section and still records all skips | gap — decided here |
| Permission & tenancy | Cross-workspace attachment request | 404 `not_found`, never 403 — do not confirm existence | `server/src/platform/errors.ts:19-22` |
| **Cross-repo** | Agent runs against a repo other than the document's | Skip and record, via the same path as a missing file. No silent same-name resolution, no new UI | D-6 |
| Content extremes | Document over 64 KB | Listed, marked over-cap, not attachable; if already attached, skipped at run with that reason | NFR-1 |
| Content extremes | Very long or deeply nested path | Middle-truncate in the row; full path on hover and in the trace | gap — decided here |
| Content extremes | Document contains `</untrusted>` | Neutralised before wrapping | `reviewer-core/src/prompt.ts:32` (already ships) |
| Content extremes | Document contains injection text ("do not flag", "this is a fixture") | Treated as data; the guard forbids scope reduction from untrusted content | `reviewer-core/src/prompt.ts:16-28` (already ships) |
| Destructive actions | Detaching a document | No confirmation — non-destructive to the file and re-attachable. A double-click must not toggle twice | gap — decided here |
| Destructive actions | Underlying file deleted | Attachment is retained and reported as skipped, never silently removed | D-1 |
| Concurrency | Two tabs attach different documents to one agent | Last write wins per attachment row; ordering is per-attachment, so the two do not clobber each other | gap — decided here |
| Navigation | Deep link to `/context` with no repo selected | Prompt to select a repo rather than erroring | gap — decided here |
| Navigation | Repo switched while on the page | List, usage counts and totals refetch for the new repo | gap — decided here |
| Theme & density | `data-theme` dark/light; `data-density` regular/compact | Both render without truncation or overlap; token counts use tabular numerals | `client/src/lib/theme.tsx`, `contracts/platform.ts:95` |
| Accessibility | Tab switching and attach toggles | `Toggle` already exposes `role="switch"`/`aria-checked`; the shared `Tabs` does **not** set `role="tab"`/`aria-selected` | `vendor/ui/kit/Tabs.tsx:25-51` — F-7 |
| Accessibility | Token estimate and budget fraction read aloud | The approximation and the budget relationship are conveyed in text, not by colour or a symbol alone | gap — decided here |
| Narrow viewport | Long document list | Path column collapses first; token count, budget fraction and toggle stay visible | gap — decided here |
| Projection — no agent in view | Page first opened, or the Skills tab is active | Per-document estimates render; no projected total, no budget fraction. Copy states that a projection requires an agent, rather than showing a selection sum | D-11 |
| Projection — skill-inherited overflow | An enabled linked skill's documents push the agent past 8 000 | The would-be-dropped marking falls on the documents that would genuinely be dropped, which may be inherited ones the user never selected on this page. The inherited documents are shown as inherited, not as direct attachments | D-9 |
| Projection — all linked skills disabled | Every skill linked to the agent is disabled | Projection counts direct attachments only; the disabled skills' documents are listed as not contributing rather than silently omitted | D-9; `reviews/repository/skill.repo.ts:22` |
| Projection — per agent, not per page | Two agents share a document but differ in attachments or enabled skills | Each agent's projection and drop marking are computed independently; the same document may be marked dropped for one and injected for the other | D-9 |
| Projection — staleness | A document changes on disk between projection and run | The run reads the current file, so the recorded size may differ. The REQ-10 agreement guarantee is stated for unchanged files only | D-8 |
| Projection — skill contribution is not a budget | A skill's contribution figure is read as a budget | No fraction and no drop marking are shown at skill level, because survival depends on the inheriting agent | D-10 |

## 7. Non-functional requirements

| Class | Agreed value | Rationale |
|---|---|---|
| Limits — per document | 64 KB; larger files listed but not attachable | Matches the existing skill-import cap and its stated reason, "small enough that one import cannot blow a prompt" (`skills/import.ts:33-34`) |
| Limits — listing | 500 documents per repo; beyond that the list is capped and says so | Well under the 5 000-file index cap (`repo-intel/constants.ts:42`); a longer list is unusable by hand |
| Limits — attachments | 20 documents per agent and per skill | Bounds the worst case before the token budget applies |
| Limits — prompt budget | **8 000 estimated tokens for the `## Project context` section, held separately from the skills budget.** The same 8 000 is projected per agent on the page before a run and enforced during it, from one counter over the same inputs | D-4, D-9. A shared budget would let attaching a document silently evict a skill — precisely the invisible failure this feature exists to remove; a projection that disagreed with enforcement would reintroduce that failure in a new form |
| Degradation order | Drop whole documents from the end of the user's order; never truncate; never fail the run | D-4; the house precedent is omit-don't-throw |
| Latency — discovery | 500 documents listed in under 2 s on a warm clone | Interactive page load over a bounded local walk |
| Latency — run injection | Under 500 ms added to run start | Bounded by 20 × 64 KB of local reads |
| Timeouts | None beyond process defaults — every read is local filesystem I/O with no network hop | Unlike `skills/import.ts`, which needs a 10 s timeout because it fetches over HTTP |
| Observability | The prompt-assembly record already reports the `specs` section's char and token size and its `untrusted:spec` source with no content (`reviews/prompt-log.ts:34,120-132`); plus one run-log line per skipped or dropped document | "Never go silent" — a shrinking prompt must be explainable without logging the prompt |
| Observability — safety | No document text may enter logs. The safety contract at `prompt-log.ts:14-21` must continue to hold, including for skip reasons: a reason names a path and a cause, never content | That module is asserted against planted secrets by `server/test/prompt-log.test.ts` |
| Data lifecycle | Attachments are rows referencing a repo path, cascade-deleted with their workspace, repo, agent or skill. Documents are never written, moved or deleted by DevDigest | Matches every existing domain table (`db/schema/agents.ts:51-63`); view-only per D-5 |
| Rate limiting | Inherits the global 120 req/min (`server/src/app.ts:96`); no per-route override | Discovery is one request per page load |

## 8. Workflow

```mermaid
flowchart TD
    A[Agent run starts] --> B{Attachments on the agent<br/>or its enabled linked skills?}
    B -- no --> Z[Omit section — prompt byte-identical to pre-feature]
    B -- yes --> C[Resolve ordered list:<br/>agent-direct first, then per enabled skill]
    C --> D{Document belongs to<br/>the repo under review?}
    D -- no --> F[Skip: record path + cross-repo reason]
    D -- yes --> E[Read from the repo clone]
    E --> G{Readable, non-empty,<br/>within 64 KB, path safe?}
    G -- no --> F
    G -- yes --> H[Add to candidate list]
    F --> I
    H --> I{Cumulative estimate<br/>over 8,000 tokens?}
    I -- yes --> J[Drop remaining whole documents<br/>record path + budget reason]
    I -- no --> K[Keep]
    J --> L
    K --> L[Pass ordered texts to the engine as project context]
    L --> M[Engine wraps each as untrusted<br/>and renders '## Project context']
    M --> N[Run completes]
    N --> O[Persist trace: prompt_assembly.specs = injected text;<br/>specs_read = every attachment + outcome]
    O --> P[Prompt Assembly opens the full text<br/>and lists injected, skipped and dropped]
    Z --> N
```

## 9. Module interactions

| From | To | What crosses | On failure | Owns the data |
|---|---|---|---|---|
| client Project Context page | server `project-context` | Repo id → documents with path, size, modified time, token estimate, over-cap flag and usage count | Show `"Couldn’t load specs"`; saved attachments unaffected | server |
| client Project Context page | server `project-context` | Agent id → the projection: budget in force, projected total, and one entry per document with its origin (direct or inherited via an enabled skill), its estimate including wrapper, and whether a run would inject or drop it | Show the document list without a projected total or drop marking, and say the projection is unavailable — never fall back to summing the selected rows | server |
| client Project Context page | server `project-context` | Attach / detach / reorder for an agent or a skill | Surface the failure and revert the toggle to its prior state; no optimistic success | server |
| server `project-context` | repo clone (local filesystem) | Read markdown by repo-relative path | Skip that document, record the reason, never throw | the user's repository — read-only |
| server `reviews` (`run-executor`) | server `project-context` | Agent id + repo id → ordered resolved texts, plus the skip/drop record | Best-effort: on any error, continue the run with no project context and log it, mirroring the skills lookup at `run-executor.ts:256-261` | server |
| server `reviews` | `reviewer-core` | Already-resolved strings via `specs` on `reviewPullRequest` | N/A — pure function, no I/O | reviewer-core owns rendering only |
| server `reviews` | `run_traces` | `prompt_assembly.specs` and `specs_read` | Trace write precedes the terminal status, per the fix in `server/INSIGHTS.md` (2026-08-17) | server |
| client trace drawer | server `reviews` | Persisted `RunTrace` | Existing drawer error handling | server |

Direction respected: `client → server → reviewer-core`. `reviewer-core` does no I/O and is
unchanged. `project-context` owns the clone read; `reviews` calls it and never reads
documents itself — the same shape as `getAgentSkillBodies` living in `reviews`' own
repository for the skills case (`reviews/repository/skill.repo.ts:7-16`).

## 10. Contract & data expectations

**Document listing** — extends the existing `SpecFile` (`contracts/platform.ts:260-265`).

| Field | Type (in prose) | Required | Meaning | Absent → consumer does |
|---|---|---|---|---|
| `path` | repo-relative POSIX path, e.g. `server/docs/intent-layer.md` | yes | Identity of the document; the attachment key | invalid row — drop it |
| `size` | integer bytes | no | File size on disk | show "—"; do not infer from tokens |
| `updated_at` | ISO timestamp | no | File mtime | show "—"; never show "just now" |
| `tokens_estimate` | integer, estimated | no | Approximate prompt cost | show "—" and exclude from the displayed total rather than counting it as 0 |
| `tokens_exact` | boolean | no | Whether a real tokenizer or the char heuristic produced it | treat as false — label as an estimate |
| `over_cap` | boolean | no | Exceeds the 64 KB per-document cap | treat as false |
| `used_by_count` | integer | no | Agents using this document, directly or via an enabled skill | show "—", not 0 |
| `content` | string | no | Full text; returned only when one document is requested, never in the list | render nothing; the list does not need it |

**Attachment** — a new contract.

| Field | Type (in prose) | Required | Meaning | Absent → consumer does |
|---|---|---|---|---|
| `path` | repo-relative POSIX path | yes | Which document | invalid row — reject |
| `repo_id` | opaque id | yes | Which repository the path resolves against | invalid row — reject; never fall back to the repo under review |
| `target_kind` | one of `agent`, `skill` | yes | What it is attached to | invalid row — reject |
| `target_id` | opaque id | yes | The agent or skill | invalid row — reject |
| `order` | integer, ascending | no | Position within the section | treat as 0 and fall back to a stable order by path, so injection order is never arbitrary |

**Projection** — returned for one agent, and the basis of REQ-10.

| Field | Type (in prose) | Required | Meaning | Absent → consumer does |
|---|---|---|---|---|
| `agent_id` | opaque id | yes | Which agent this projection is for | render no projection; a projection is meaningless unattributed |
| `budget_tokens` | integer | yes | The section budget in force, currently 8 000 | render the total with no fraction rather than assuming a default |
| `projected_tokens` | integer, estimated | yes | Total a run would send: surviving documents plus wrappers plus the section heading | show "—" and no fraction; never fall back to summing rows |
| `entries` | list, in injection order | yes | One per document the agent would consider | render per-document estimates only, with no projection |
| `entries[].path` | repo-relative POSIX path | yes | The document | drop the entry |
| `entries[].origin` | one of `agent`, `skill` | yes | Direct attachment, or inherited from an enabled linked skill | treat as `agent`; inherited documents would otherwise look user-selected |
| `entries[].via_skill_id` | opaque id | no | The skill it was inherited through | omit the attribution; still show the entry |
| `entries[].tokens_estimate` | integer, estimated | no | Cost including its wrapper | show "—" and exclude from the total rather than counting 0 |
| `entries[].outcome` | one of `injected`, `dropped_budget`, `skipped` | yes | What a run would do with it now | treat as `injected` — but then the marking is wrong, so prefer showing the entry unmarked and flagging the projection as unavailable |

**`RunTrace.specs_read` — unchanged shape, newly populated.** It stays
`z.array(z.string())` (`contracts/trace.ts:91`), so there is **no contract edit and no fixture
break** (`server/test/contracts.test.ts:194`). Each element is a repo-relative path; elements
for documents that were not injected carry a trailing human-readable reason. A consumer that
does not parse the reason still renders a useful path — which is exactly what
`TraceBody.tsx:44-48` does today.

**Data expectations in prose.** A document must exist in the repo's local clone at run time
to be injected; nothing guarantees it still exists, since the clone advances independently via
`POST /repos/:id/resync`. A token estimate may be stale relative to the file a run actually
reads — an attachment stores a path, not content. `repos.clone_path` may be null, in which
case nothing can be discovered or injected. The text shown in Prompt Assembly for a past run
comes from the stored trace and is authoritative for that run even if the file has since
changed or been deleted.

## 11. UX findings & recommendations

| Screen | Finding | Severity | Recommendation | Decision |
|---|---|---|---|---|
| Project Context | **Neither design bundle contains tabs, an attach control, or a per-document token count.** The design's Project Context page is a spec list with a preview/edit pane. The attach model in this spec is therefore a **new design decision, not an existing screen** | blocker | Say so plainly and design the two tabs against existing primitives rather than implying the design specified them | Adopted — REQ-8 is new design |
| Project Context | The shipped empty-state copy states the **opposite attachment model**: "Every agent and the PR brief read them as grounding context" (`context.json:13`) — i.e. all documents reach all agents automatically | blocker | Rewrite that copy for the per-target model and for the allow-listed directories. **This copy change is part of this spec** | Adopted — D-1 |
| Project Context | The design shows size in **kb** (`context.json:10`); the requirement asks for tokens | should | Token estimate primary, kb secondary; keep the `"kb"` key | Adopted |
| Project Context | The design ships a full **editor** — `mode.preview`, `mode.edit`, `editor.save`, `editor.saving`, `editor.loadError` (`context.json:15-23`) — which view-only rejects | should | Leave the five keys unused rather than deleting shipped copy | Adopted — D-5 records the rejection and its reasoning |
| Project Context | The design's aggregate indicator reads `"Indexed: 12 files · 1,240 chunks"`, and the page assumes an indexing/embedding backend — `chunks`, `reindex`, `indexing`, `resync`, `indexStatus` (`context.json:3-8`) — that does not exist for markdown; `useReindexContext` already posts to a non-existent `/context/reindex` (`hooks/core.ts:131-137`) | should | Remove the re-index controls, and **replace the chunk count with a tokens total**. The `"chunks"` key is **superseded, not reused** — the tokens-total label is new copy | Adopted — D-7 |
| Elsewhere in the design | A budget fraction of the form **`"412 / 8,000 tokens"`** already exists as a presentation pattern | idea | Read it across to REQ-10 verbatim in form, with the numerator being the **per-agent projection**, never a sum of selected rows | Adopted — and it is why the budget is 8 000 (D-4) |
| Project Context | A sum of the page's selected rows is **not** the number the user asked for. It understates the true cost three ways: documents inherited from enabled linked skills, `<untrusted>` wrapper plus section-heading overhead, and budget elision (documents over 8 000 never reach the prompt at all) | blocker | Show a per-agent projection of what a run would send, and mark would-be-dropped documents **before** the run instead of leaving them to be discovered afterwards in the trace | Adopted — D-9, REQ-10 |
| Prompt Assembly | **Design-vs-code divergence.** The shipped `TraceBody` renders more prompt slots than the design bundle shows — `repo_map`, `callers` and `intent` were added by later lessons (`contracts/trace.ts:44-54`) after the bundle was exported | should | **The code wins.** Add nothing to the drawer; the project-context block already exists at `TraceBody.tsx:85-87` | Adopted — spec follows the code |
| Prompt Assembly | The shipped label reads "Project context (dynamic)" (`runs.json:50`), close to the requested "project context attached specs" | idea | Keep it — consistent with siblings "Skills (dynamic)", "Memory (dynamic)" | Adopted — reuse shipped copy |
| Prompt Assembly | "Specs read" (`runs.json:35`) will now carry skip reasons, so the label under-describes it | idea | Leave the label; the rows are self-describing | Adopted |
| Sidebar | `vendor/ui/nav.ts:21-36` has **no `context` item**, though `shell.json:20` has the label and `helpers.ts:30` maps the active key | should | Add the nav item; the label and active-key mapping already exist | Adopted — REQ-8 |
| Shared primitive | `Tabs` renders bare `<button>`s with no `role="tab"`, `aria-selected` or arrow-key handling (`vendor/ui/kit/Tabs.tsx:25-51`) | should | Fix in the shared primitive so the four existing tabbed screens benefit; arguably its own change | Recommended, not required here — §14 open |
| Shared behaviour | Density is a Settings contract field (`contracts/platform.ts:95`) but `themeNoFlashScript` pins it to `regular` (`client/src/lib/theme.tsx:44`) | idea | Honour stored density; out of scope here | Recorded only |

## 12. Traceability

| REQ | ACs | Corner cases | Interactions | Design screen | e2e flow |
|---|---|---|---|---|---|
| REQ-1 | AC-1, AC-2 | Cardinality zero; Failure ×2; Freshness (stale clone) | client page → server | Project Context (list exists) | 08-project-context |
| REQ-2 | AC-3, AC-4, AC-5, AC-6 | Content extremes (over-cap, long path) | server → clone | Project Context | 08-project-context |
| REQ-3 | AC-7, AC-8, AC-26 | Freshness (estimate currency); Projection (staleness); Theme & density; Accessibility | client page → server | new — not in design | 08-project-context |
| REQ-4 | AC-9, AC-10 | Concurrency; Destructive (detach) | client page → server | new — Agents tab | 08-project-context |
| REQ-5 | AC-9, AC-11 | Concurrency | client page → server | new — Skills tab | 08-project-context |
| REQ-6 | AC-11, AC-12, AC-30 | Degraded dependency; Projection (all linked skills disabled) | reviews → project-context | new | 08-project-context |
| REQ-7 | AC-13, AC-21 | Permission & tenancy; Cross-repo | client page → server | new | — (single workspace locally) |
| REQ-8 | AC-14, AC-15 | Loading; Navigation ×2; Narrow viewport; Accessibility | client page → server | Project Context + new tabs | 08-project-context |
| REQ-9 | AC-16 | Cardinality many | client page → server | new | 08-project-context |
| REQ-10 | AC-17, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31 | Projection ×6 (no agent in view; skill-inherited overflow; all skills disabled; per agent not per page; staleness; skill contribution is not a budget); Narrow viewport; Accessibility | client page → server | budget fraction read across (numerator now a projection) | 08-project-context |
| REQ-11 | AC-18, AC-19, AC-11 | Cardinality zero attachments; Freshness (file changed) | reviews → project-context → reviewer-core | — (server-side) | 08-project-context (asserts the section; no LLM) |
| REQ-12 | AC-20, AC-21 | Degraded dependency ×2; Destructive (file deleted); Cross-repo | reviews → project-context | — | — |
| REQ-13 | AC-22, AC-27 | Cardinality many; Projection (per agent, not per page) | reviews → project-context | — | — |
| REQ-14 | AC-23, AC-24, AC-25 | Freshness (old run); Cardinality zero attachments | reviews → run_traces; client drawer → server | Prompt Assembly (code wins) | 08-project-context |

## 13. Decisions

| Question | Answer | Date |
|---|---|---|
| Whose markdown is this? | The **connected GitHub repository under review**, read from its local clone. Settled by code: the pre-shipped hook is repo-keyed (`hooks/core.ts:126`), the contract calls it the "Project Context folder" (`contracts/platform.ts:12`), and repo files reach the server only via `repos.clone_path` | 2026-08-27 |
| D-1: Attachment model | **Per-target.** Skills and Agents tabs on the Project Context page. This is a **new design decision** — neither bundle has tabs, an attach control or a token count. The shipped copy at `context.json:13` states the opposite model ("Every agent and the PR brief read them") and **must be rewritten as part of this spec** | 2026-08-27 |
| D-2: Discovery root | **An allow-list of documentation directories** — `docs`, `doc`, `specs`, `spec`, `plans`, `plan`, `rfcs` (reusing `REFERENCE_DOC_DIRS`, `intent/constants.ts:6`) plus `.devdigest/specs/`. Not repo-wide; not `.devdigest/specs/` alone. Traversal guard and exclusion list retained. **"All markdown in the project" is satisfied in spirit** — every place specs and docs actually live. Deliberately **not** listed: root `README.md`, `CLAUDE.md`, `INSIGHTS.md`, `AUDIT.md`, per-package `README.md`s outside those directories, and anything inside excluded directories | 2026-08-27 |
| D-2a: How the allow-list is matched | Against **any path segment**, not a top-level prefix. `isSafeRepoPath` matches a leading prefix (`intent/references.ts:65`), which in this very repository would miss `server/docs/`, `client/docs/` and `reviewer-core/specs/` — every doc directory it has. A deliberate widening of the precedent, recorded so it is not "corrected" back | 2026-08-27 |
| D-3: Usage display | **A count only** — how many agents use a skill, and how many use a document. No graphs, no per-run history, no last-used timestamps | 2026-08-27 |
| D-4: Budget | **8 000 estimated tokens for the project-context section, separate from the skills budget.** A shared budget would let attaching a document silently evict a skill — exactly the invisible failure this feature removes. Over budget, drop **whole documents** from the end of the order; never truncate, since truncation can cut a "must not" and invert a spec. Presented as a fraction, reading across the design's existing `"412 / 8,000 tokens"` pattern | 2026-08-27 |
| D-5: Editing | **View-only.** Write-back is far from trivial: the documented PAT scope is `Contents (read)` (`settings.json:15`), the clone is shallow and is overwritten by `POST /repos/:id/resync`, and committing would mean opening a PR against the user's repository via `GitHubClient.commitFiles` — the mechanism behind the CI-workflow PR (`ci.json:90`). Rejected alternative: the in-place editor the shipped copy already anticipates | 2026-08-27 |
| D-6: Cross-repo | The attachment stores **`repo_id`**. When an agent runs against a different repository, that document is **skipped and recorded** through the same path as a missing file. No silent resolution of a same-named file from another project, and no new UI | 2026-08-27 |
| D-7: Index/embedding controls and the aggregate indicator | **Removed and replaced.** No Re-index button and no index status; discovery is a direct read of the clone per request. The design's aggregate indicator `"Indexed: 12 files · 1,240 chunks"` has its **chunk count replaced by a tokens total**, so `context.json`'s `"chunks"` key is **superseded by new copy, not reused**. The remaining shipped keys (`reindex`, `indexing`, `resync`, `indexStatus`) are left unused rather than deleted, and `useReindexContext` is left unwired. Because the page has no refresh affordance, it surfaces the clone's last-synced time and defers to the existing repo-level resync (§6, Freshness) | 2026-08-27 |
| D-8: Versioning | **None.** No version history, no pinned snapshots, no diffing. Documents are read live at run start. Preserving the sent text costs nothing extra, because `run_traces.trace` is already one jsonb document holding the whole `prompt_assembly` (`db/schema/runs.ts:37-42`) — so `prompt_assembly.specs` **is** the per-run record of exactly what was sent. Nothing is given up | 2026-08-27 |
| D-9: What "tokens total" means | **A per-agent projection of what a run would actually send — not a sum of selected rows.** It covers the agent's direct attachments plus those inherited from its **enabled** linked skills, includes each document's `<untrusted>` wrapper and the section heading, and marks the documents that would be dropped for budget before the run. The selection sum was rejected because it understates the real cost three ways — inherited documents, wrapper overhead, and budget elision — and every one of them errs in the same direction, so the user would consistently believe the prompt is cheaper than it is. Because the inherited set and the order differ per agent, the projection and its drop marking are **necessarily computed per agent**; a page-wide figure would be incoherent. The projected number and the section size recorded for a run with the same configuration and unchanged files must agree — an extension of REQ-3's single-counter rule, not a second rule | 2026-08-27 |
| D-10: What the Skills tab totals | **A contribution figure, not a budget.** A skill has no budget of its own and whether its documents survive depends on the inheriting agent, but the documents and their wrappers are agent-independent. So a skill shows what it adds to every agent that has it enabled — documents plus wrapper, no section heading — with **no budget fraction and no drop marking**, both of which would be unknowable at skill level | 2026-08-27 |
| D-11: What the page shows with no agent in view | **Per-document estimates only — no total and no fraction.** The only figure available without an agent is the selection sum, which is exactly the misleading number D-9 rejects. The page states that choosing an agent is required to see a projection rather than displaying a number it cannot stand behind | 2026-08-27 |
| Trust level of a skill-attached document | **Always the untrusted project-context slot**, never a skill body. Letting an arbitrary repo file inherit skill-level trust (`trusted:linked-skills`, `prompt-log.ts:31`) would be a privilege escalation | 2026-08-27 |
| Disabled skills | A document attached to a skill reaches an agent only when that skill is **linked and enabled**, mirroring the SQL-enforced rule at `reviews/repository/skill.repo.ts:22` | 2026-08-27 |
| Does `reviewer-core` change? | **No.** Its `specs` path is complete (`reviewer-core/INSIGHTS.md`, 2026-08-17) | 2026-08-27 |
| Does the `RunTrace` contract change? | **No.** Skips are annotated strings inside the existing `specs_read: string[]` | 2026-08-27 |

## 14. Assumptions & open questions

**Assumptions in force**

- The token estimate is materially wrong in absolute terms. Anthropic ships no reliable
  offline tokenizer, and its own guidance is that the current-generation Claude tokenizer
  yields roughly 30% more tokens than earlier models, while this repo counts with
  `cl100k_base` (`adapters/tokenizer/index.ts:32`). This spec therefore never claims accuracy
  — only that the figure is labelled an estimate (REQ-3). *Invalidated by:* adopting an exact
  counting mechanism, which would let AC-8's estimate label be dropped. **Consistency between
  the displayed estimate, the projection and budget enforcement is no longer an assumption:**
  it is required by REQ-3 and REQ-10 and tested by AC-26 and AC-27.
- **AC-26 and AC-27 assert exact agreement, not a tolerance**, and that is only defensible
  while the projection and the run count the same assembled text with the same counter — so
  any drift is a bug rather than rounding. *Invalidated by:* an implementation in which the
  two paths cannot share a counter or assemble the text identically. If that turns out to be
  the case, AC-26 weakens to a stated tolerance and D-9's central guarantee — that the page
  and the run agree — weakens with it, which would materially reduce the value of the
  projection. This is a known risk carried into planning, not a settled question.
- The real prompt-token figure is recovered after the fact from the provider
  (`reviewer-core/src/llm/openrouter.ts:94` → `stats.tokens_in`), so the trace carries a
  ground truth even though the pre-run number is an estimate.
- A repo's allow-listed markdown is small enough that a direct walk needs no index.
  *Invalidated by:* a repo where discovery exceeds the 2 s budget.
- No prior art exists for per-document token counts in a context-attachment UI — Cursor,
  Claude Code, Continue.dev and Copilot show none — so REQ-3 and REQ-10 have no convention to
  inherit, and the degradation order is set from this repo's own precedents.
- The 8 000-token budget is affordable alongside the diff for the models in use.
  *Invalidated by:* runs where project context plus diff exceed a model's context window,
  which would make the budget model-dependent rather than fixed.

**Open (non-blocking)**

- Should an agent's own editor show its attached documents read-only? Its tabs are
  Config/Skills/Evals/Stats/CI (`agents.json:46-52`) with no context tab — product owner.
- Should the shared `Tabs` primitive gain `role="tab"`/`aria-selected`? It affects four
  existing screens, so it is arguably its own change — front-end owner.
- Should the density preference be honoured rather than pinned to `regular`
  (`client/src/lib/theme.tsx:44`)? — front-end owner.
- Is `08` still free for the e2e flow at implementation time? `01`–`07` are taken today.

## 15. Done means

A reviewer can: open Project Context for a cloned repo and see its documentation markdown with
per-document token estimates; select an agent and see a projected total against 8 000 that
includes documents inherited from its enabled skills; attach documents until the projection
exceeds the budget and see the would-be-dropped documents marked **before** running anything;
run that agent on a PR and confirm the section size recorded for the run equals the projected
number, and that the documents dropped by the run are exactly those the page marked; open the
run's trace drawer and expand "Project context" to read the exact text that was sent; disable
a linked skill and confirm both the projection and a re-run stop including its documents;
delete one of the attached files and re-run, seeing the run succeed with that file listed in
"Specs read" with a skip reason. AC-1 through AC-31 pass, and an e2e flow named
`08-project-context.flow.json` covers the page, both tabs, the projection with its drop
marking, and the trace drawer's project-context block — calling no LLM, as `e2e/CLAUDE.md`
requires of deterministic flows.

## Sources

- `reviewer-core/src/prompt.ts:16-34, 39-85, 97-167` — injection guard, `wrapUntrusted`, `specs` → `## Project context`, `assembly.specs`
- `reviewer-core/src/review/run.ts:100-118, 128-148` — `ReviewOutcome`; `specs` forwarded to `assemblePrompt`
- `server/src/modules/reviews/run-executor.ts:200-296, 378-386, 545-559` — the sole caller; `specs` never passed; `specs_read: []` hardcoded at both trace sites; the L02 skills comment describing this exact situation
- `server/src/modules/reviews/repository/skill.repo.ts:7-26` — ordered, enabled-filtered link resolution
- `server/src/modules/reviews/prompt-log.ts:14-40, 103-153` — content-free observability and its safety contract
- `server/src/platform/trace-builder.ts:19-62`; `server/src/db/schema/runs.ts:8-42` — trace assembly and single-jsonb persistence
- `server/src/vendor/shared/contracts/trace.ts:39-94` — `PromptAssembly.specs`, `RunTrace.specs_read`, and the later-lesson slots
- `server/src/vendor/shared/contracts/platform.ts:12, 92-101, 259-274` — "Project Context folder", density, `SpecFile`, `IndexStatus`
- `server/src/db/schema/{agents,skills,repos,context,knowledge,core}.ts` — `agent_skills` as the ordered-link precedent; **no** document-attachment table exists
- `server/src/adapters/tokenizer/index.ts:14-40`; `server/src/platform/container.ts:32,133-138` — `cl100k_base` counter with `approxTokens` fallback
- `server/src/modules/intent/constants.ts:5-18`; `intent/references.ts:47-66` — `REFERENCE_DOC_DIRS`, `isSafeRepoPath` (prefix-matching), budget precedent
- `server/src/modules/skills/import.ts:22-34, 80-85` — 64 KB per-document cap and its rationale
- `server/src/modules/repo-intel/constants.ts:13-53` — excluded dirs, file/size caps, 1 500-token repo-map budget
- `server/src/app.ts:93-100`; `server/src/platform/errors.ts:7-39`; `server/src/modules/_shared/context.ts:4-38` — rate limit, error semantics, tenancy
- `server/src/modules/index.ts:26-43` — registry naming `context` as a planned lesson module
- `client/src/lib/hooks/core.ts:122-137`; `client/src/lib/hooks/repo-intel.ts:28` — pre-shipped hooks against a non-existent route; the `ProjectContextView` reference
- `client/messages/en/context.json` (whole file); `shell.json:20`; `runs.json:19-53`; `agents.json:46-52, 90-95`; `settings.json:15`; `ci.json:90` — shipped copy with zero readers; PAT scope; commit-files context
- `client/src/app/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx:19-113`; `PromptBlock/PromptBlock.tsx:23-63` — the already-shipped Prompt Assembly UI
- `client/src/vendor/ui/nav.ts:21-44`; `components/app-shell/helpers.ts:26-40`; `vendor/ui/kit/Tabs.tsx`; `vendor/ui/primitives/Toggle.tsx:13-16` — missing `context` nav item; `/context` active key; Tabs/Toggle primitives
- `server/test/contracts.test.ts:186-198` — `specs_read` fixture proving the string-array shape
- `server/INSIGHTS.md` (2026-08-17, 2026-08-20, 2026-08-23); `client/INSIGHTS.md` (2026-08-02, 2026-08-23); `reviewer-core/INSIGHTS.md` (2026-08-17); `e2e/INSIGHTS.md` (empty) — scoped reads
- researcher: *Extract the Project Context page from the design bundle* → the page is a spec list with a preview/edit pane; **no tabs, no attach control, no per-document token count** in either bundle; a `"412 / 8,000 tokens"` budget-fraction pattern exists elsewhere in the design
- researcher: *Do comparable products show per-document token counts and how do they handle overflow?* → none in the set (Cursor, Claude Code, Continue.dev, Copilot) shows a per-document count; no industry drop-order convention exists
- researcher: *How accurate is a js-tiktoken count versus Claude's real count?* → no reliable offline Anthropic tokenizer; exact counts only via a counting API; current-generation tokenizer documented at ~30% more tokens than earlier models
