# Fix Brief — round 1

Five findings from Stage 2's three review lenses. **Everything not listed here is out of
scope** — no refactors, no renames, no "while I'm here". Two confirmed findings were
deliberately left as follow-ups and must NOT be touched: the run route's rate limit, and the
macro-averaging of per-case precision into batch metrics.

Baseline right now, all green: server unit 530 · server integration 127 · client 222 ·
`pnpm verify:l06` exit 0. Anything red after your change is yours.

---

## F1 — `verify:l06` does not verify two of the things it reports on

- **Source:** security-review + code-review
- **Severity:** major
- **File:** `scripts/verify-l06.sh`

Two independent holes in the same script, both of the same shape: a check whose green
result costs nothing.

**F1a — the protected-zone check passes vacuously on any committed branch.**
`scripts/verify-l06.sh:149-150` uses `git status --porcelain <paths>`, which reports only
*uncommitted* changes. On this branch, and on any branch a reviewer or CI checks out, the
tree is clean — so the check prints nothing and passes regardless of what the branch
actually did to `vendor/shared` or `db/migrations`. It can only fail on a dirty working
tree, i.e. it never tests the invariant it documents.

Use `git diff --name-only main...HEAD -- <paths>` so it examines what the branch *changed*.
Keep a working-tree check too if you like, but the branch-diff one is the invariant.

**F1b — the no-LLM check skips the one file that holds a provider.**
`no_llm_in` is applied only to `scoring.ts` and `repository.ts` (`:172-173`), never to
`service.ts`. The security reviewer proved this is exploitable-by-accident: appending
`await llm.completeStructured([{ role: "user", content: c.inputDiff }], Review)` to
`service.ts` left all checks green. Meanwhile `server/src/modules/evals/service.ts:53-56`
carries a comment asserting the opposite — "Nothing in this module assembles a prompt by
hand, and `verify:l06` checks that statically".

Add a `service.ts` variant matching `.complete(` / `completeStructured` but **not**
`container.llm`, which `service.ts` legitimately uses to obtain the provider it hands to
`reviewPullRequest`. Also switch the `no_assemble_prompt` glob from
`server/src/modules/evals/*.ts` to a recursive `find`, so a future subdirectory is covered.

- **Done when:** appending a direct `completeStructured` call to `service.ts` makes
  `verify:l06` exit non-zero naming that check, and reverting restores exit 0. Prove both,
  then restore. Separately, prove F1a: a committed change under `server/src/vendor/shared`
  must fail the check on a clean tree.

---

## F2 — the Evals tab reports "Never run" for cases that just ran

- **Source:** code-review
- **Severity:** major
- **Files:** `server/src/modules/evals/service.ts:62,65`, and `EvalsTab.tsx` if needed

`RECENT_RUNS_LIMIT` is 25 while `MAX_CASES_PER_RUN` is 50. `EvalsTab.tsx:22-27` derives each
case's last result from `dashboard.recent_runs`, and all rows of one batch share an
identical `ranAt`, so `orderBy(desc(ranAt), desc(id))` truncates *within* the newest batch.

Failure: an agent with 30 cases, run once. 30 rows written, 25 returned. Five cases render
"Never run" immediately after passing. AC-16 ("list every case with its last result") is
silently violated, and it reads as if the run dropped cases.

Either raise the limit to at least `MAX_CASES_PER_RUN`, or return a per-case last result
instead of slicing a recent-runs feed. Prefer whichever keeps the dashboard's own
recent-runs feed sensibly sized.

- **Done when:** a set larger than `RECENT_RUNS_LIMIT` runs once and **every** case shows a
  result. Cover it with a test.

---

## F3 — the dashboard prints a flattering 100% precision

- **Source:** code-review
- **Severity:** major (an accepted recommendation, REC-2, implemented only halfway)
- **Files:** `client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx:216,278`, plus whatever server field it needs

The drill-down `MetricCard` honours `dash.alert` (`:124`), but the per-agent overview list
(`:278`) and the batch-history table (`:216`) print `pct(precision)` unconditionally.

Failure: an agent whose set is all `must_find` and whose latest run produced nothing on a
labelled line scores `precision = 1` by the spec's own `TP + FP = 0` rule — and the overview
row reads **100%** for an agent that has demonstrated nothing. This is precisely the
"flattering number" the spec's open question 2 names and REC-2 was accepted to prevent.

Note the workspace-level `alert` cannot be reused here: it is derived from `batches[0]`, the
newest batch across *all* agents, so it cannot correctly annotate a per-agent row. This
needs a per-agent flag on `AgentEvalSummary` (server side, additive as the others are).

- **Done when:** an agent with no labelled findings renders "n/a" — not "100%" — in the
  overview row and in the batch-history table, proven by a test.

---

## F4 — the scorer's walk order makes two documented claims false

- **Source:** code-review
- **Severity:** minor, but the fix is three lines and it removes a data-side workaround
- **File:** `server/src/modules/evals/scoring.ts:66-99`

**F4a.** `classifyFindings` (`:130-143`) deliberately lets `must_find` win when a finding
overlaps both kinds, but `matchFindings` orders only by `(file, start, end, original
index)`. With expectations `[{must_not_flag a.ts 10-20}, {must_find a.ts 10-20}]` and one
finding at `a.ts:15`, the `must_not_flag` claims it and `pass` is **false**, while precision
simultaneously scores it `tp` and reports 1.0. Swapping the array positions flips `pass`.
Sort `must_find` before `must_not_flag` in the walk order and the two functions agree by
construction. The seed's comment ("no case ever asks the agent to both find and not find the
same lines") is a data-side workaround for this; the scorer should not need it.

**F4b.** The docstring at `:66-81` claims the result "depends only on the CONTENT of the
inputs and not on the order they happen to arrive in". True for expectations, false for
findings: the inner loop walks `findings` in array order. Also `localeCompare` (`:95`) is
locale-sensitive, so the order is not byte-stable across machines with different `LANG` —
use a plain `<` / `>` comparison.

Both need ≥2 mutually overlapping expectations in one case, which today's creation path
never produces (always exactly one). Fix the code rather than the docstring where you can;
where greedy genuinely cannot be order-independent, correct the claim instead of leaving it
overstated.

- **Done when:** the two scenarios above are covered by named tests, and no comment in the
  file states an invariant the code does not hold.

---

## F5 — Compare can freeze the tab on long prompts

- **Source:** code-review
- **Severity:** major (a crash on the feature's headline screen)
- **File:** `client/src/app/eval/_components/CompareModal/CompareModal.tsx:27-57`

`diffWords` allocates a full O(n·m) DP matrix over whitespace-split tokens:
`Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))`. Two 8,000-word system
prompts are ~16,000 tokens each → a 256M-cell matrix, roughly 2 GB of JS numbers, freezing
or crashing the tab the moment Compare is pressed. System prompts are free-text and
user-edited, so the input is unbounded.

A length guard falling back to a line-level diff removes the cliff. Hirschberg is not
required and is not worth it here.

- **Done when:** two very long prompts render a usable diff without allocating a quadratic
  matrix, proven by a test that would have blown up before the fix.

---

## Out of scope — do not touch

- The run route's rate limit (`10/min` for a route costing up to 50 model calls). Real, but
  it is a policy decision, not a defect, and `LocalNoAuthProvider` means the caller is
  already privileged.
- Batch metrics macro-averaging per-case precision instead of pooling TP/FP. It damps the
  signal the feature exists to show (0.67 vs a pooled 0.40 on the seeded degraded batch),
  but AC-24 still holds and changing it is a design decision for the spec, not a fix round.
- Anything not listed above.
