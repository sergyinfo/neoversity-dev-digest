# Fix Brief — round 2

Source: the minors from Stage 2's three reviews, scoped by the user to **tests and input
validation**. Base: `148151c` plus the docs and run-log commits.

Baselines to hold: server **34 files / 464** unit and **11 / 107** integration, client
**24 / 171**. Nothing green may turn red.

**Out of scope:** C5 (the seeded trace's heading), C6 (`SkillsTab`'s `0` vs `—`), S3 (the
fence-close escape), S7 (the count TOCTOU). They stay open in the run log. No refactors, no
renames, nothing outside the five findings below.

---

## F7 — three tests are weaker than their own names

- **Source:** correctness review, test-quality notes
- **Severity:** major in effect, whatever its label — a test that cannot fail is worse than a
  missing one, because it reports safety nobody has

Three separate cases:

1. **`server/test/prompt-log.test.ts`** — "a skip reason supplied by the caller is passed
   through unquoted" builds the second document's content as `` `  ${DOC_SECRET.slice(0, 0)}  ` ``.
   `slice(0,0)` is `''`, so **the planted secret is whitespace**. The `skipped` deep-equal that
   runs is real; the leak guard the test is named for plants nothing.
2. **`server/test/routes-smoke.test.ts`** — the comment says "AC-5's envelope half: a traversal
   path is refused at the edge", but the payload sends `path: ''`. `'../../etc/passwd'` passes
   `z.string().min(1)` and is refused by the **handler**, not the schema, so the edge case the
   comment claims is not exercised.
3. **`server/test/reviews.it.test.ts`** (~`:750`) — the AC-26 log line is located with
   `msg.startsWith('project context:') && msg.includes('tokens')`, which **also matches** the
   `dropped for budget (N tokens)` line. Drops are logged first, so in any run with a drop the
   `/~(\d+) tokens/` match returns null and the `!` throws a **TypeError** instead of failing an
   assertion. It passes today only because that test has no drops.

- **Done when:** each test exercises what its name claims — a real secret is planted and
  asserted absent; a genuine traversal path is sent and the assertion says which layer refused
  it; and the AC-26 line is located by something that cannot match the drop line, with the
  match's absence failing as an assertion rather than throwing. **Prove each is now capable of
  failing**: break the thing it guards, watch it go red, restore.

## F8 — `usageCounts` splits its composite key on the first space

- **Source:** correctness review, finding 4 · also spotted independently by the security review
- **Evidence:** `server/src/modules/project-context/repository.ts:311-312` builds
  `` `${r.path} ${r.agentId}` `` and recovers the path with `key.slice(0, key.indexOf(' '))`.
  `isSafeRelPath` and the walk both permit spaces in filenames.
- **Failure:** `docs/my notes.md` → key `"docs/my notes.md <uuid>"` → parsed path `"docs/my"`.
  `byPath["docs/my notes.md"]` is then `undefined`, so `listDocs` omits `used_by_count` and the
  row renders **"—"** for a document that *is* in use — the exact "absent is not zero"
  distinction this contract is built around — plus a phantom `docs/my` bucket. Two paths sharing
  a prefix before a space also collide and sum.
- **Done when:** the count is correct for a path containing a space, proven by a test with such
  a path. A tuple key or a split on the **last** space both work; say which you chose.

## F9 — non-UUID ids reach UUID columns and echo the Postgres message

- **Source:** security review, finding 4
- **Evidence:** `routes.ts:48-50` (`ListAttachmentsQuery.target_id: z.string().min(1)`) and
  `contract.ts:86-95` (`repo_id`, `target_id`). `IdParams` (`_shared/schemas.ts:11`) is
  `z.string().uuid()` **precisely** so "an invalid id becomes a clean 422 instead of a
  downstream DB/500" — these new body and query ids skip that convention.
- **Failure:** the value flows into `eq(t.agents.id, id)` against a `uuid` column → PG `22P02`,
  and the global handler (`app.ts:160-163`) returns `message: e.message`, so the raw Postgres
  text is echoed to the caller.
- **Done when:** every id-shaped field in this module's request schemas is `.uuid()`, a
  malformed id returns the **422 `validation_error`** envelope, and a test asserts the envelope
  rather than merely a non-500.

## F10 — unbounded `path` length and `order` magnitude

- **Source:** security review, finding 5
- **Evidence:** `AttachmentInput.path` is `z.string().min(1)` with no max; `order` is
  `z.number().int().nullish()` with no bounds. When `clone_path` is null, `attach` skips the
  `readDoc` check entirely (`service.ts:151`) and inserts.
- **Failure:** a path over ~2 704 bytes blows the btree limit on
  `ctx_att_agent_repo_path_uq` — **the exact failure mode already documented for `symbols.name`
  in the same schema file** (`db/schema/context.ts:23-34`) and not applied here. An `order`
  beyond 2³¹ overflows the `integer` column. Both surface as 500s with the raw PG message.
- **Done when:** both fields carry bounds that make the failure a 422 at the edge instead of a
  500 from the database, with the `symbols.name` precedent cited in the code, and a test for
  each.

## F11 — `isSafeRelPath` accepts control characters

- **Source:** security review, finding 6
- **Evidence:** `discovery.ts:137-146` rejects empty, NUL, absolute and `..`, but not `\n`,
  `\r` or other control bytes. Verified by the reviewer:
  `isSafeRelPath('docs/a\nFAKE.md') === true`. That path reaches
  `runLog.info(\`project context: skipped ${s.path} — ${s.reason}\`)` and `specs_read`.
- **Real impact is limited** — `RunLogger.logFor` stores structured objects and the client
  renders through React, so log forging is blocked by structure rather than by validation. Fix
  it anyway: this is the one field the gate lets through untouched, and it is user-supplied.
- **Done when:** control characters are rejected, with a test.

---

## Verification for the round

- `cd server && pnpm typecheck` · `cd client && pnpm typecheck`
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot`
- `cd server && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock pnpm exec vitest run .it.test --reporter=dot`
  — without `DOCKER_HOST` these fail rather than skip
- `cd client && pnpm test -- --reporter=dot`

F8, F9, F10 and F11 each get a regression test written so it **fails against the current code
before your fix**. F7 is different in kind: its three tests already exist and already pass, so
for each one **break the thing it guards and show it now goes red**, which is the only way to
prove a vacuous test has stopped being vacuous.

There is no linter in this repo.

**Push back with evidence** rather than fixing something you believe is wrong.
