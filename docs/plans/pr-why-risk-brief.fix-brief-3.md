# Fix Brief — round 3

Source: Stage 4 verification (`plan-verifier`, 2026-08-28). Two criteria the run
finished without: one the pipeline created between rounds, one the plan contained
from the start. The user chose to close both rather than record them.

Base: `1b44305`. Baselines to hold: server **401** unit + **64** integration,
client **143**. Nothing green may turn red.

**Out of scope:** everything not listed. In particular do **not** render the new
exhaustion fact on the card — spec F-10 deferred that deliberately ("a warning
nobody can act on"), and the provenance record is where a maintainer looks.

---

## F8 — REQ-4a's exhaustion record does not exist
- **Severity:** major — an approved spec says SHALL and the code does not
- **Spec:** REQ-4a (`server/specs/brief/01-pr-why-risk-brief.md`) — the system
  "SHALL record both the actual estimate **and the fact that the drop order was
  exhausted**". §7 *Observability* repeats it: the per-assembly record carries
  "whether the drop order was exhausted with the input still over budget".
- **Evidence it is missing:** `assemble.ts:376-377` breaks out of the drive-down
  loop and sets no flag; `provenance.ts:70-84` has no such field; and
  `grep -rn "AC-7a\|REQ-4a\|exhausted" server/test/ server/src/modules/brief/`
  finds only unrelated hits about the 12 KB reference budget.
- **Why it matters concretely:** a reader of a stored brief can see
  `estimated_input_tokens` and a `dropped_items` list, but **cannot distinguish**
  "we dropped items and landed under budget" from "we ran out of things to drop
  and sent it anyway". §14's assumption that the floor case is rare is stated as
  *invalidated by the exhausted-order flag appearing for briefs nobody crafted* —
  which is unfalsifiable while the flag does not exist.
- **Done when:** the assembler records the fact, it survives into the stored
  provenance record, and AC-7a's scenario is covered by a test.

**Two constraints, both learned the hard way in round 2 — do not relearn them:**
- **A stored row written before this change must still read.** New provenance
  fields go `.optional()` on the Zod schema and **required on the writer input**,
  so no writer can forget one while every existing row keeps parsing. A required
  schema field there is not a compile error anywhere; it silently turns every
  stored row into "provenance unreadable".
- **Do not overload an existing field.** `dropped_items` being non-empty does not
  mean the order was exhausted, and an estimate above the budget is a consequence,
  not the fact itself.

**The test must be better than the one it joins.** `brief-assemble.test.ts:294-326`
forces the floor with `countTokens: () => 1_000_000` — a counter no input could
satisfy — which proves the branch runs but not that a real diff can reach it. AC-7a
names the real scenario: a **single** changed file whose re-rendered `@@` headers
alone exceed 8 000 estimated tokens, with no references, no linked issue and one
blast symbol. Build that fixture with a realistic many-hunk patch and the real
tokenizer. AC-7a also requires that **exactly one structured call is still issued
and no error is raised**, which a pure-function test cannot assert — that half needs
an integration test.

## F9 — AC-28 has no e2e coverage
- **Severity:** major (a criterion the plan marked `Verified by: e2e flow`)
- **The plan contradicted itself:** S19 required an empty-state assertion for "a PR
  with no brief", while S18 gave the only seeded PR a brief and authorised no
  second one. T7 dropped the assertion rather than invent the fixture, which was
  the right call at the time.
- **Done when:** the seed carries a second pull request with **no** `pr_brief` row,
  and `e2e/specs/09-pr-brief.flow.json` asserts on it that the empty state and its
  generate control render — **without ever pressing generate**, which is what keeps
  AC-34 true structurally.

**The seed is shared demo data and other flows read it. This is the risk in F9.**
Flows `01`, `02`, `04` and `05` all navigate by matching PR-list text and by PR
#482. Before you add anything, read every flow in `e2e/specs/` and confirm what a
second PR row changes: list ordering, the first-repo redirect `01` asserts, and any
`find text … click` that could become ambiguous. If a second PR would perturb an
existing flow, say so and propose the smallest fixture that does not — a PR whose
title cannot collide is cheaper than a broken suite. Give the new PR `pr_files`
rows, since a PR with none is refused with 422 and would exercise the wrong path.

---

## Verification
- `cd server && pnpm typecheck` · `cd client && pnpm typecheck`
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot`
- `cd server && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock pnpm exec vitest run .it.test --reporter=dot`
  — without `DOCKER_HOST` these fail rather than skip
- `cd client && pnpm test -- --reporter=dot`
- `diff -rq server/src/vendor/shared client/src/vendor/shared` must print nothing
- `pnpm db:seed` on a fresh DB, run twice, to prove idempotency

**On `./scripts/e2e.sh`: it gives 5/8 on this machine and has since before this
work.** Flows `04`, `05` and `09` fail on the same `find text … click` because a
real GitHub PAT in `~/.devdigest/secrets.json` makes the PR-list load do a doomed
~1 s 404, and `find` does not poll the way `wait` does. Two people have now
reproduced it against an unmodified tree. **Do not report your flow as passing on
the strength of having written it**, and do not "fix" it with a stabilising `wait`
that papers over the environment — say what you ran, what it gave, and that CI is
what settles it.

There is no linter in this repo.

**Push back with evidence** on anything you believe is wrong rather than fixing it
quietly — that moves it to `contested` and the user decides.
