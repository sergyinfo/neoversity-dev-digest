# Project Context — attach repo markdown to agents and skills

A reviewing agent has always had the diff, the repo skeleton, callers and derived intent, but
never the PRDs, tech specs and acceptance criteria sitting in the repository itself.
`reviewer-core` has rendered a `## Project context` section from a `specs` input since it was
written (`reviewer-core/src/prompt.ts:97-167`); the server passed nothing to it until this
feature (`server/specs/project-context/01-project-context.md:22`). Project Context discovers
markdown in a repo's allow-listed documentation directories, lets a user attach chosen documents
to agents and skills, projects the token cost a run would actually send, injects the attached
text into the review prompt as untrusted context, and records exactly what was sent in the run
trace.

Spec: `server/specs/project-context/01-project-context.md` (`approved`). Plan and run log:
`docs/plans/project-context.md`, `docs/plans/project-context.run.md`.

Two properties define the design, and most of the review effort went into proving them:

- **Two independent gates guard every read**, and neither substitutes for the other. See
  [The two gates](#the-two-gates-containment-and-the-allow-list).
- **The page and the run agree exactly** on what a run would send, because both call the same
  assemble function over the same counter. See [One number, two
  callers](#one-number-two-callers).

## Where it lives

| File | Role |
|---|---|
| `modules/project-context/discovery.ts` | The walk, the allow-list predicates, and `safeDocPath` — the combined containment + allow-list gate |
| `modules/project-context/assemble.ts` | `assembleProjectContext` — the one function the projection route and the run both call |
| `modules/project-context/repository.ts` | Workspace-scoped attachment CRUD, `resolveForAgent`, usage counts |
| `modules/project-context/service.ts` | Orchestration: `listDocs`, `attach`/`detach`/`reorder`, `resolveFor`, `projectForAgent` |
| `modules/project-context/routes.ts` | `GET /repos/:id/context`, attach/detach/reorder, `GET /agents/:id/context/projection` |
| `modules/project-context/constants.ts` | Allow-list constants, byte/document/token caps |
| `modules/project-context/contract.ts` | Module-local Zod envelopes (`ContextDocList`, `Projection`, …) |
| `db/schema/context.ts` → `contextAttachments` | Storage — two nullable FKs, two partial unique indexes |
| `modules/reviews/run-executor.ts:267-321,338-347,455` | Injection into `runOneAgent`, `specs_read` population |
| `client/src/app/context/` | The `/context` page — Agents and Skills tabs |
| `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/` | Read-only per-agent projection inside the Agent Editor |
| `client/src/components/ProjectionSummary/` | Cross-route pure render of the server's projection payload |

Other modules reach the service through **`container.projectContext`**, typed narrowly as the
single `resolveFor` method (`service.ts:61-67`) — the same shape as `RepoIntel` — so a test stub
for `run-executor` never has to reimplement the repository. The module's own routes construct
`ProjectContextService` directly, which is a module using its own service, not a cross-module
reach.

`reviewer-core` needs **zero changes**. Its `specs` path — `specsBlock` built at
`prompt.ts:106-108`, rendered as `## Project context` at `:132`, recorded to `assembly.specs` at
`:154` — was already complete for a different, unbuilt caller.

## The two gates: containment and the allow-list

REQ-2 states two predicates in one sentence — "the extension is `.md`/`.mdx` **and** some
segment of the path is an allow-listed documentation directory (or it sits under
`.devdigest/specs/`); any path escaping the repo root is refused." Reading that as one gate is
the mistake the security review caught.

**Containment** is a `realpath` of the candidate file compared against a `realpath` of the clone
root (`discovery.ts:196-213`, `safeDocPath`). It answers exactly one question: *does this path
stay inside the clone?* `.git/config` answers yes — it is a perfectly ordinary file inside the
clone directory. Containment alone can never refuse it, no matter how carefully it is written.

**The allow-list** — `.md`/`.mdx` extension, an allow-listed directory segment or the
`.devdigest/specs/` prefix, and not inside `EXCLUDED_DIRS` — answers a different question: *is
this the kind of file that belongs in a prompt?* Before this feature's own fix round, that
predicate (`isDiscoverableDocPath`, `discovery.ts:109-114`) lived **only inside the discovery
walk**. `attach()` and `readDoc()` — the two call sites that actually feed a model — checked
containment and nothing else. A security review proved the gap by executing the module directly:
`readDoc('.git/config')` returned `url = https://x-access-token:ghp_…@github.com/…` — the GitHub
PAT that `withGitHubToken` embeds in the clone URL, verbatim, never rewritten after clone. A test
suite covering only path traversal (`../../../etc/passwd`, absolute paths, null bytes) proves
containment works and says nothing about the allow-list, because every one of those traversal
cases fails containment first — none of them exercises the second gate at all.

The fix moved `isDiscoverableDocPath` inside `safeDocPath`, so containment and the allow-list are
now one function (`discovery.ts:196-213`) called at every read. No caller — not `attach()`, not
`readDoc()`, not a future one — can apply half of it. `isDiscoverableDocPath` is also exported
and re-checked directly in `service.ts:150` at attach time, so a path the walk would never list
cannot even be stored as an attachment, let alone read.

**Why the read gate, not the attach gate, is the one that matters.** An attachment stores a
*path*, not content, and the clone advances independently through the existing
`POST /repos/:id/resync`. Validating a path only when it is attached is a TOCTOU hole across a
resync: a path that was a plain file on Monday can be a symlink escaping the clone by Tuesday.
`safeDocPath` is therefore called immediately before **every** read — by the discovery walk, by
`attach()`'s over-cap check, and by the run's `readAttachment` — never once at attach time and
trusted afterward.

The allow-list itself is two predicates with different matching semantics, not one list
(`constants.ts:11-57`):

- `CONTEXT_DOC_DIR_SEGMENTS` matches **any path segment** (`hasAllowedSegment`,
  `discovery.ts:61-67`), a deliberate widening of the Intent Layer's own guard,
  `isSafeRepoPath` (`modules/intent/references.ts:78-88`), which prefix-matches and would miss
  `server/docs/`, `client/docs/` and `reviewer-core/specs/` — every documentation directory this
  repository actually has.
- `CONTEXT_DOC_PATH_PREFIXES` matches as a **leading prefix**, and exists only for
  `.devdigest/specs/`. Putting that string into the segment list would look correct and do
  nothing: `.devdigest/specs` is a two-segment string and can never equal one segment. The
  discovery test suite exercises the prefix branch with the segment list stubbed to exclude
  `specs`, so a future edit that quietly drops the prefix predicate fails loudly instead of
  narrowing discovery in a way nothing else would catch.

## One number, two callers

`assembleProjectContext` (`assemble.ts:108-188`) is called by both `projectForAgent` (the
projection route) and `resolveFor` (the run path, via `run-executor.ts:286-321`), over the same
ordered documents and the same `container.tokenizer`. That sharing — not a shared formula
re-derived twice — is what makes AC-26 ("the projected total equals the section size recorded
for the run") assertable as *exact equality* rather than a tolerance.

`sectionTokens` counts the `## Project context` heading plus the joined, wrapped blocks
(`assemble.ts:87-97, 128-129, 176-185`) — i.e. exactly what `reviewer-core` renders into the
prompt for that section. `wrapUntrusted` is imported from `@devdigest/reviewer-core` rather than
restated, so the measured block is byte-identical to the one the engine actually sends.

The adjacent trap: `describePromptAssembly` (`server/src/modules/reviews/prompt-log.ts:103-132`)
counts `assembly.specs`, and `assembly.specs` is the joined wrapped blocks **without** the
heading — `prompt.ts:132` puts the heading into `user`, not into `specs`. The two numbers differ
by construction, not by bug, and always will: `prompt-log.ts` was deliberately left unmodified,
because its existing number has an existing meaning (it also backs every other prompt section's
stat) and redefining it to include a heading that only this one section has would be a breaking
change to every other section's number. `sectionTokens` is recorded separately, on its own
run-log line (`run-executor.ts:301-317`), specifically so AC-26 has something to assert against
that was never going to equal `prompt-log.ts`'s figure.

```mermaid
flowchart TD
    A["GET /repos/:id/context"] --> B["resolveCloneRoot(clone_path)"]
    B -->|"null"| B1["reason: not_cloned"]
    B -->|"realpath ENOENT"| B2["reason: clone_missing"]
    B -->|"ok"| C["discoverDocs — walk + safeDocPath per file"]
    C --> D["SpecFile[] + tokens_estimate + used_by_count"]

    E["GET /agents/:id/context/projection?repo_id=…"] --> F["resolveForAgent<br/>direct + enabled-skill attachments"]
    F --> G["readAttachment per document<br/>cross-repo skip, safeDocPath, size cap"]
    G --> H["assembleProjectContext<br/>SAME function as the run"]
    H --> I["Projection: projected_tokens, per-entry outcome"]

    J["Agent run starts — runOneAgent"] --> K["container.projectContext.resolveFor"]
    K --> F
    H --> L["specs: texts (spread, omit-when-empty)<br/>sectionTokens on a run-log line"]
    L --> M["reviewPullRequest → assemblePrompt<br/>## Project context, wrapUntrusted"]
    M --> N["run_traces: prompt_assembly.specs<br/>specs_read = specsReadFor(result)"]
    N --> O["Prompt Assembly view opens the full text;<br/>Specs read lists every attachment + outcome"]
```

## Why the projection requires a repository

`projectForAgent` takes a **required** `repo_id` (`contract.ts:195-199`, `service.ts:302-329`).
Without one, the cross-repo skip in `readAttachment` — "is this document's `repoId` the one under
review?" (D-6) — has nothing to compare against on the projection path. The first implementation
passed each attachment's own `repoId` back to itself as the "repo under review," so the guard
evaluated `att.repoId !== reviewRepoId` as `x !== x`: permanently false, the branch dead. A
multi-repo agent's projection therefore showed documents as injected that a real run — which
always runs against one specific repository — would have skipped, breaking AC-26's equality
silently rather than loudly. `resolveFor` now takes the repository explicitly and is the single
implementation both `projectForAgent` and `run-executor` delegate to (`service.ts:245-285`), so
the cross-repo skip is reachable, and identically reachable, on both paths.

The client keeps the two views trivially in agreement by construction rather than by
coincidence: `/context`'s tabs and the Agent Editor's `ContextTab` both scope the projection to
`useActiveRepo()` — the one repo the rest of the shell is already showing
(`ContextTab.tsx:16-24`).

## Two bounds, and what they really bound

Two limits exist in `constants.ts`, and only one of them bounds what a run actually reads.

`MAX_ATTACHMENTS_PER_TARGET = 20` bounds one target's own attachment list — 20 documents on one
agent, 20 on one skill. It does **not** bound a run, because `resolveForAgent` returns an
agent's direct attachments **plus** those of every one of its enabled linked skills, and linking
a skill (`linkSkill`) is an unbounded upsert. An agent linked to 100 skills, each carrying 20
attachments, resolves up to 2,020 documents — every one `stat`-ed, read and tokenized before the
8,000-token budget ever gets a chance to drop anything, on both the run and the uncached
projection route.

`MAX_DOCS_PER_RESOLUTION = 40` (`constants.ts:100-125`) is what actually bounds a run: the
agent's own 20 plus at most 20 more inherited across *all* enabled linked skills combined,
applied inside `resolveFor` before any document past the limit is read (`service.ts:254-269`).
This is a deliberate judgement call, not a value the spec states — REQ-12 enumerates five skip
causes (missing, unreadable, empty, over-cap, cross-repo) and the 40-document ceiling adds a
**sixth that REQ-12 does not name**. It is applied through the one shared `resolveFor`, so it
still shows up identically in the projection and in `RunTrace.specs_read` with its own reason
string, and AC-26/AC-27's equality still holds — no acceptance criterion exercises a
configuration that hits it, and none fails. It is a named deviation, recorded in the constant's
own comment and in the run log, not a silent one.

## Configuration

| Constant | Value | What it bounds |
|---|---|---|
| `MAX_DOC_BYTES` | 64 KB | Per-document read cap; matches `skills/import.ts`'s existing rationale |
| `MAX_LISTED_DOCS` | 500 | Documents shown per repo before the list says it is capped |
| `MAX_ATTACHMENTS_PER_TARGET` | 20 | One target's (agent's or skill's) own attachment count |
| `MAX_DOCS_PER_RESOLUTION` | 40 | The real per-run/per-projection read ceiling — see above |
| `PROJECT_CONTEXT_TOKEN_BUDGET` | 8,000 | The `## Project context` section budget, held **separately** from the skills budget so attaching a document can never silently evict a skill |

Over budget, whole documents are dropped from the end of the attachment order — never truncated
mid-document, since a truncated document can sever a "must not" from its clause and invert its
meaning (`assemble.ts:32-44`). A dropped document does not stop the loop: a later, smaller
document may still fit, which is what keeps the projection's "would be dropped" set and the
run's actual drop set the same *set*, not merely the same count.

## Data model

`contextAttachments` (`db/schema/context.ts`) carries two nullable FKs, `agent_id` and
`skill_id`, with `CHECK (num_nonnulls(agent_id, skill_id) = 1)` rather than a polymorphic
`target_id` — required so both can cascade-delete with their owning agent or skill. A plain
4-column unique index over `(agent_id, skill_id, repo_id, path)` would not enforce
one-row-per-target: Postgres treats every `NULL` as distinct from every other `NULL`, so two
agent attachments — both carrying `skill_id = NULL` — pass a standard unique check. The table
instead declares two **partial** unique indexes, one per target kind
(`uniqueIndex(...).on(agentId, repoId, path).where(sql`agent_id is not null`)` and its skill
mirror), which states the actual invariant directly rather than relying on the `CHECK` constraint
to make a 4-column index mean the right thing. Every FK is `ON DELETE CASCADE`.

## Trust level

A document attached to a **skill** still reaches the model through the same untrusted
project-context slot as one attached directly to an agent — never the trusted `skills` body slot
(`trusted:linked-skills` in `prompt-log.ts`). Letting an arbitrary repository file inherit
skill-level trust would be a privilege escalation: a skill body is authored inside DevDigest, a
project-context document is whatever text sits in the connected repository.

## Known deviations from the spec

- **`MAX_DOCS_PER_RESOLUTION`** — see [Two bounds](#two-bounds-and-what-they-really-bound) above;
  a sixth, unenumerated skip cause.
- **`SkillsTab`'s contribution figure omits the wrapper allowance.** No
  `GET /skills/:id/context/projection`-shaped endpoint exists — S8 built only the per-agent
  projection. Rather than re-derive the wrapper-inclusive arithmetic client-side (the exact
  understatement D-9 exists to prevent for the agent case), `SkillsTab` sums each attached
  document's own `tokens_estimate` from the document listing — content-only, no
  `<untrusted source="...">` wrapper, no separator (`SkillsTab.tsx:41-68`). The number shown is
  therefore always somewhat lower than what the skill actually costs an inheriting agent. This is
  a named, flagged gap (`SkillsTab.tsx:47-56`), not a silent one, and matches D-10's decision that
  a skill shows a contribution figure, never a budget.
- **AC-24's e2e half is unreached on a machine carrying a real GitHub PAT.** Flow
  `08-project-context.flow.json` passes 26 of its 37 steps and fails at step 27 — a shared
  PR-list navigation step, not project-context logic — which also breaks flows `04`, `05` and
  `09` on the same machine. AC-14, which covers the page and both tabs independently, is fully
  green. CI, or running with `HOME` scoped away from a real PAT, settles it.

## Nine minor findings, open at the end

The fix round (`docs/plans/project-context.run.md`) scoped itself to one blocker and five
majors; the following nine were deliberately left open rather than folded into that round, to
keep the fix diff reviewable. They are **open, not fixed** as of this writing:

| # | Finding |
|---|---|
| C4 | `usageCounts` splits its composite key on the first space, so `docs/my notes.md` mis-parses |
| C5 | The seeded demo trace writes `sectionText` (heading included) into `prompt_assembly.specs`, which a real run never does — the exact conflation the heading/`assembly.specs` boundary above exists to prevent |
| C6 | `SkillsTab` renders `(contribution ?? 0)`, so "no attachments" and "estimates unmeasurable" both read as 0 tokens |
| C7 | Three tests are weaker than their names claim (a planted-secret fixture that is an empty string; a traversal test that sends `path: ''`; an AC-26 matcher that also matches the drop line) |
| S3 | The untrusted-fence escape (`wrapUntrusted`) is exact-match and case-sensitive; `</UNTRUSTED>` and similar survive |
| S4 | A non-UUID id reaching a UUID column surfaces as a raw Postgres `22P02` in a 500 |
| S5 | `path` has no max length; a very long not-yet-cloned attachment can exceed the btree index limit |
| S6 | `isSafeRelPath` accepts control characters, which are then interpolated into log messages |
| S7 | The per-target attachment cap is a read-then-insert TOCTOU with no DB-level backstop |

## Tests

| Suite | What it covers |
|---|---|
| `server/test/project-context-discovery.test.ts` | Allow-list segment vs. prefix matching in isolation, traversal/absolute/null-byte rejection, symlink-escape, non-leading-segment discovery, missing-clone-root classification |
| `server/test/project-context-schema.it.test.ts` | The partial unique indexes reject a duplicate agent attachment and a duplicate skill attachment; the `num_nonnulls` check |
| `server/test/project-context-assemble.test.ts` | Empty input → empty array (AC-19's mechanism), budget overflow drops whole documents, order preservation |
| `server/test/project-context.it.test.ts` | Discovery routes, the three list outcomes (documents / `not_cloned` / `clone_missing`), attach/detach/reorder, cross-workspace 404, the projection endpoint |
| `server/test/reviews.it.test.ts` | Injection into a real run, cross-repo skip, budget drop, `specs_read`, AC-26/AC-27 equality, AC-19's byte-identical prompt |
| `server/test/prompt-log.test.ts` | Planted-secret fixture in a skip-reason string — no document content ever reaches a log line |
| `client/src/components/ProjectionSummary/ProjectionSummary.test.tsx` | Pure render of a server payload — no-agent state, budget fraction, disabled-skill "not contributing" rendering |
| `client/.../TraceBody/TraceBody.test.tsx` | Project-context block expands with the full text; "Specs read" shows outcomes; the "none" empty state |
| `e2e/specs/08-project-context.flow.json` | The page, both tabs, the projection with its real drop marking, the Agent Editor Context tab, and the trace drawer's project-context block — against a committed fixture clone, calling no LLM |

## Known limits

- **No skill-level projection endpoint.** See `SkillsTab`'s contribution figure, above.
- **The token estimate is a `cl100k_base` count, not a real count for the models this repo
  actually calls.** Same caveat as the Intent Layer's own estimate (`server/docs/intent-layer.md`
  § Configuration); consistency between the displayed estimate, the projection and enforcement is
  the tested property, not absolute accuracy.
- **A document's estimate can go stale between being shown and a run reading it.** An attachment
  stores a path, not content; the run always reads the current file on disk.
- **Nine minor findings listed above are open**, not regressions introduced later — see the run
  log for round-1 scope.
