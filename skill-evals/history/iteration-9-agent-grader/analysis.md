# Iteration 9 — the grader became an agent, and the dependency-checker delta became real

Nine plant patterns in a row had missed a finding that was filed under wording the regex
did not carry. The instrument was the problem, so grading moved to a subagent that reads
the review and judges, with the rubric staying in code.

## The measurement, on identical data

Same eight reviews. Same plants. Only the grader changed.

| | regex | agent | hand-read |
|---|---|---|---|
| with_skill finds the plant | 0/3 | **3/3** | 3/3 |
| without_skill finds it | 0/5 | **2–3/5** | 2/5 |

The regex said "no effect" where the effect was +0.40 to +0.60.

## Final result for dependency-checker

| Metric | with_skill | without_skill | Delta |
|---|---|---|---|
| Pass rate | 100% | 53% | **+0.47** |
| `taught` recall | 100% | 60% | **+0.40** |
| `control` recall | 100% | 100% | +0.00 |

Controls flat, so the movement is the check that was added to the skill and nothing else.

## What the agent grader is, and what it costs

It decides two things per run — was each planted defect *filed as a finding*, and was any
correct-as-written control filed as one — and returns them as JSON. The rubric, the pass
rate and the gates stay in `finishGrade`, so two runs remain comparable and no prompt gets
to invent its own scoring.

It gets Bash deliberately. The one failure class nothing else ever caught was a finding
that cited the right line, carried a working fix, and rested on a false premise; the only
thing that ever surfaced those was an agent executing the claimed payload. There is now an
assertion for it.

The prompt's load-bearing sentence: *"Filed as a finding" means the review asserts it is a
problem, in its findings list. Mentioning the code, quoting it, or listing it under
"checked and correct" is NOT filing it.* That is what closes the self-scoring hole, where a
pattern matched a phrase the skill instructs the reviewer to write.

**It is not deterministic.** Two agent passes over the same eight reviews agreed on seven.
The one disagreement was the borderline case — a baseline review saying `mcp` "cannot be
typechecked from a clean clone without installing `server`", which is the symptom of the
missing declaration rather than the claim itself. I hesitated over that one by hand too.

So: the regex was reproducibly wrong; the agent is right and slightly unstable. Report the
delta as **+0.40 ± one borderline case in five**, not as a precise figure. When a delta
decides something, run the grader twice — a disagreement between passes is itself the
signal that the plant is loosely stated.

## Three fixes this exposed

**Agent verdicts were never persisted.** `--grade-only --grader agent` computed its
judgements and wrote them nowhere, so the expensive verdict lived only in the console
while stale regex verdicts sat on disk. The new `--grader stored` mode read those and
reported `taught 0% vs 0%` — the exact result we had just established was wrong. Caught
only by comparing against the previous pass. `gradeExisting` now persists.

**`--grader stored`** re-scores from judgements already made, with no model call. Whether a
plant was filed as a finding does not depend on how the rubric weighs it, so a rubric
change should cost nothing and should not roll the dice again.

**The LOW-discipline assertion was inapplicable here.** It comes from the security skill,
whose rule is "LOW → do not report". `dependency-checker` prescribes a `P3 — hygiene` tier
of its own, so the assertion was penalising the skill for following its own template —
which is why every run scored 3/4 and none scored full marks. It is now opt-out per suite
(`lowDisciplineApplies: false`). This is the same defect the grader agent identified in
iteration 5: a rubric written for one suite and carried to another without re-examination.
I repeated it.

## And a fix to the skill itself

The alias-declaration check moved out of the skill's prose and into `scripts/scan.mjs`,
which now emits `undeclaredAliases`. It found **12**, including `@devdigest/ui` in
`client`, which I had not noticed when writing the report by hand.

That is the general lesson for skill design here: **anything computable belongs in a
bundled script, not in a paragraph the model has to remember.** A model does not forget to
run a script; it forgets one item out of ten in prose.
