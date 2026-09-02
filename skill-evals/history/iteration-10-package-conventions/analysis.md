# Iteration 10 — package-conventions. The agent already reads the guides.

The question: in a repo where every package carries its own CLAUDE.md, does telling the
reviewer to find and read that guide change whether package rules get enforced?

Four scenarios were merged into one fixture to stay inside a six-run budget.
`mini-devdigest` — 21 files, four packages, each with its own CLAUDE.md — so one run
exercises four package guides instead of four separate suites costing four times as much.

Five plants, each breaking a rule stated only in that package's guide and nowhere in the
code, each with a correct twin nearby:

| Plant | Package | The violation reads as |
|---|---|---|
| score from `response.confidence` | reviewer-core | an ordinary implementation; the correct `score.ts` sits beside it, uncalled |
| `readFileSync` for skill bodies | reviewer-core | convenience; breaks the no-I/O iron rule |
| `throw` on an unindexed repo | server | exemplary fail-fast |
| bare `fetch` + local `interface Pull` | client | a self-contained component |
| an `llm` step in a flow | e2e | a richer test |
| **control:** `request.body as {...}`, unvalidated | server | nothing — visible to anyone, no guide needed |

The skill deliberately restates no convention. It teaches only the procedure — find the
package, read its guide, build a checklist, then judge — so the run measures whether the
guides get read, not whether the answers were handed over. Both arms can read them; they
are inside the fixture.

## Result, second pass

| Metric | with_skill | without_skill | Delta |
|---|---|---|---|
| Pass rate | 78% | **89%** | **-0.11** |
| `convention` recall | 100% | 100% | **+0.00** |
| `control` recall | 100% | 100% | +0.00 |

**Both arms found all five convention violations, in every run.** The model walks into
`client/CLAUDE.md` and `reviewer-core/CLAUDE.md` without being told to. That is the answer
to the question the skill was written for, and it is negative.

## The first pass, and what fixing it cost

The first version scored `convention` 100%/100% as well — but `control` 0% against 100%.
The skill arm missed the unvalidated body cast in every run; the baseline caught it every
time. The skill says "extract the rules into a checklist before you read the code", and
attention narrowed to exactly that checklist. A defect no guide mentions fell outside it.

That is what `maxCategoryRecallDelta` is for. It was added to catch confounds — a control
moving means something other than the change under test moved — and here it caught a real
cost of the skill instead. Worth keeping either way: the gate said "this is not a clean
story", and it was right.

A section was added — *"The checklist is additional, not a substitute… if your findings all
cite a guide, you have written half a review"* — and it worked: control went to 100%/100%,
findings per review rose from 6 to 9–11.

And it introduced a new failure. Pass rate fell below the baseline, not from missed plants
but from a **false claim**: the grader, running the code, caught a finding resting on "a
hallucinated survivor of the substring grounding check". Wider review, more findings, more
invented ones.

## What this says

Eighth rule in a row that the model follows unaided. But the first time a skill scored
*worse* than its absence, and the mechanism is legible: it pushed for a broader review
where the baseline was already complete, and the extra volume carried a hallucination.

Both interventions were reactions to measurement, and each moved the skill in a different
direction — the first narrowed and lost the control, the second widened and gained a false
claim. That reads as oscillation around behaviour that was already correct without it.

**Recommendation: do not keep `package-conventions` as a skill.** The one line worth
saving — that a review citing only guide rules is half a review — belongs in the root
CLAUDE.md, not in a skill that costs a load and changes nothing.

## Limits

n=3 per arm. The -0.11 rests on one hallucination in one run; "the skill harms" is not
supportable on this data. "No benefit is visible" is, and that is enough to not keep it.

Two environment failures in the first pass, one of them new: the grader died to
`Connection lost while your computer was asleep` *after* the review was written and paid
for. The grader now retries once — far cheaper than re-running an executor.
