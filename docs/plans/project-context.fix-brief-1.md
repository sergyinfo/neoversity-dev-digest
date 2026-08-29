# Fix Brief — round 1

Source: Stage 2, three parallel reviews of `1e9aeda..HEAD`. One blocker, five majors.
Base: `aa7bf6c` plus the run-log commits. Baselines to hold: server **34 files / 455**
unit and **11 / 98** integration, client **24 / 164**. Nothing green may turn red.

**Out of scope: everything not listed here.** The minors (C4–C7, S3–S7) are deliberately
held for round 2 or for follow-up — do not fix them, do not refactor around them, and do
not rename anything while you are in these files.

---

## F1 — BLOCKER — the read gate enforces containment but not the allow-list

- **Source:** security review, finding 1
- **Evidence, executed rather than argued:** the reviewer ran the real module against a temp
  clone and got `readDoc('.git/config')` → `{"ok":true,"content":"[remote \"origin\"]\n\turl =
  https://x-access-token:ghp_SECRET@github.com/a/b.git\n"}`, plus `.env` and
  `node_modules/evil/x.md`. The walk correctly lists none of the three.
- **Where it comes from:** the `.md`/`.mdx` filter (`discovery.ts:317`), the doc-directory
  allow-list (`:321`) and the `EXCLUDED_DIRS` skip (`:312`) live **only inside `walkDir`**.
  `attach()` (`service.ts:113-177`) checks `isSafeRelPath` → repo/target exist → not a
  duplicate → under 20 → not `over_cap`/`unsafe_path`. `readDoc()` checks containment. Neither
  applies the allow-list. **Any file inside the clone can be attached and read.**
- **Why the payload is real, not hypothetical:** `withGitHubToken` puts the PAT into the clone
  URL (`repos/helpers.ts:29-40`), `git clone` writes that URL verbatim into `.git/config`, and
  nothing rewrites the remote afterwards. `GITHUB_TOKEN` is a **single global secret** with no
  workspace argument. On the next run the content reaches the LLM provider *and* is persisted
  into `prompt_assembly`, which AC-24 has the trace drawer render in full.
- **Done when:** the allow-list predicates are enforced **at every gate that feeds the model**,
  not only in the walk — attach refuses a non-allow-listed path with a 422, and the read
  refuses it too, so an attachment stored before this fix cannot be read either. A path that
  the walk would not list must not be attachable or readable **by any route or by the run
  path**. Tests: `.git/config`, `.env`, `README.md` at the clone root, `src/notes.md`, and a
  `node_modules/**/x.md` are each refused at attach **and** at read; the existing traversal
  cases keep passing.
- **The spec is on your side here.** REQ-2 states the allow-list *as part of* the security
  requirement — "a traversal bug here reads arbitrary host files into a prompt". The escape
  half shipped; the allow-list half did not reach the two places that actually feed the model.

## F2 — major — the projection can never apply the cross-repo skip

- **Source:** correctness review, finding 1
- **Evidence:** `service.ts:250` passes `att.repoId` as `reviewRepoId`, so `readAttachment`'s
  guard at `:286` evaluates `x !== x` — permanently false, the branch is dead on the
  projection path.
- **Failure:** agent `A` has `docs/a.md` from `R1` and `docs/b.md` from `R2`. A run against a
  PR in `R1` skips `b.md`; the projection injects both. **AC-26's "agree exactly" fails**, and
  `ProjectionOutcome.skipped` — documented at `contract.ts:115-116` as covering "wrong repo" —
  is a state the projection cannot emit for that cause.
- **The root cause is structural:** the projection endpoint takes no repo, so it has nothing to
  compare against. Decide how to give it one and **say what you chose** — a query parameter,
  the active repo, or an explicit "projection is per repo" contract change. Whatever you pick,
  the projection and the run must agree for a multi-repo agent, and a test must prove it.
- **Done when:** a multi-repo agent's projection and run produce the same outcomes and the same
  `sectionTokens`, asserted by a test that fails against today's code.

## F3 — major — no dedupe in `resolveForAgent`

- **Source:** correctness review, finding 2
- **Evidence:** `repository.ts:234-243` concatenates `direct` and `inherited` with no dedupe by
  `(repoId, path)`. The two partial unique indexes are **per target kind**, so nothing prevents
  the same path arriving on both lists.
- **Failure:** a document attached directly to `A` **and** to an enabled skill linked to `A` is
  rendered twice into the prompt as `spec-0` and `spec-1` with byte-identical bodies, and pays
  the budget twice — which can push a *different* document out. `usageCounts` already dedupes
  this exact configuration for display, so the page says 1 while the run sends 2.
- **Two knock-ons, same root cause, fix them with it:** `ProjectionSummary.tsx:102` uses
  `key={entry.path}`, which collides for the duplicated entries; and `assemble.ts:193-194`
  keys `specsReadFor`'s reason map by `path`, so one cause overwrites the other.
- **Done when:** a document reachable both ways appears once, with a defined origin — say which
  you kept and why — and a test covers the direct-plus-inherited configuration.

## F4 — major — `attachedPaths` ignores `repo_id`, and detach removes the wrong row

- **Source:** correctness review, finding 3
- **Evidence:** `AgentsTab.tsx:35-38,63` and `SkillsTab.tsx:26-29,71` build the set from
  `a.path` alone; `repository.listForTarget:99-108` filters by workspace and target only,
  **never by repo**, and the rows carry `repo_id` which the client discards.
- **Failure:** `R1` and `R2` both contain `docs/prd.md`, attached from `R2`. Open `/context`
  with `R1` active: the toggle renders **on** for a document not attached here, so `R1`'s copy
  cannot be attached at all — and switching the toggle off calls
  `find(a => a.path === doc.path)`, which returns `R2`'s row. **`DELETE` then removes an
  attachment belonging to a repository the user is not looking at.**
- **Done when:** the comparison is `a.path === doc.path && a.repo_id === repoId`, both tabs are
  fixed, and a test renders `AgentsTab` with a **non-empty** agent list — no client test does
  today, which is why this was invisible.

## F5 — major — the per-target cap does not bound per-run reads

- **Source:** security review, finding 2
- **Evidence:** `MAX_ATTACHMENTS_PER_TARGET` is documented as "20 × 64 KB is the ceiling on
  run-time local reads". `resolveForAgent` returns the agent's 20 **plus 20 per enabled linked
  skill** (`repository.ts:195-244`), and `linkSkill` (`agents/repository.ts:208-218`) is an
  unbounded upsert. Real ceiling `20 × (1 + N_skills)`, every document `stat`-ed, read and
  **tokenized before the budget drops anything** (`assemble.ts:145-157`).
- **Failure:** 100 linked skills ⇒ ~2 020 reads, ~129 MB, ~2 020 tokenizer passes — on the run
  **and** on `GET /agents/:id/context/projection`, which is uncached and sits behind only the
  global 120/min limiter. §7's "under 500 ms" is not attainable in that shape.
- **Done when:** the number of documents actually read per resolution is bounded by something
  that does not grow with the skill count, the constant's comment states the true ceiling, and
  a test proves the bound. **Say what bound you chose** — the spec fixes the per-target cap, not
  the aggregate, so this is a judgement call and I want it named rather than assumed.

## F6 — major — `run-executor` constructs another module's service directly

- **Source:** architecture review, finding A1
- **Evidence:** `run-executor.ts:19` imports `ProjectContextService`; `:289` does
  `new ProjectContextService(this.container).resolveFor(...)`. Every sibling capability is
  reached through the container — `container.repoIntel`, `container.intent(log)`,
  `container.blast` — and `container.ts` states the rule twice in its own comments: "so
  consuming modules reach it the same way they reach `repoIntel` instead of importing another
  module's service class".
- **What it costs:** the `ContainerOverrides` injection seam that `repoIntel`, `tokenizer`,
  `webFetch` and `depgraph` all have. A reviews-run test cannot stub project context and must
  stand up a real clone on disk.
- **Also fix the comment.** `run-executor.ts:15-18` justifies the import with "same reasoning"
  as the `intent/block.js` import above it — but that one is justified as a **leaf module,
  contract types only**, while `project-context/service.ts` imports the container and is not a
  leaf. The reasoning does not carry over, and leaving the comment would preserve a wrong
  justification for the next reader.
- **Done when:** the service is reached through a container getter of the `blast` shape, with a
  `ContainerOverrides` field, and the misleading comment is gone.

---

## Verification for the round

- `cd server && pnpm typecheck` · `cd client && pnpm typecheck`
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot`
- `cd server && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock pnpm exec vitest run .it.test --reporter=dot`
  — without `DOCKER_HOST` these fail rather than skip
- `cd client && pnpm test -- --reporter=dot`
- `diff -rq server/src/vendor/shared client/src/vendor/shared` must print nothing

**Every one of these six is a real defect, so every one gets a regression test in this round,
written so it fails against the current code before your fix.** Say where you verified that.

There is no linter in this repo.

**Push back with evidence** on anything you believe is wrong rather than fixing it quietly —
that moves it to `contested` and the user decides.
