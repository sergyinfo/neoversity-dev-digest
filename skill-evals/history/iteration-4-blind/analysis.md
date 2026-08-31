# Iteration 4 — blind comparison, and the result that contradicts iteration 3

No new executor runs. The 18 reviews from iteration 3 were paired into 9 blind
comparisons (with_skill vs without_skill, same case, same run index), copied to
neutral `A.md` / `B.md` paths so no path string could unblind the judge, and given to
9 independent comparator agents following `skill-creator/agents/comparator.md`. Each
built its own rubric for the task, scored both outputs 1–10, and picked a winner.
No assertions were supplied — that is the point of this instrument.

Which arm sat in slot A alternated: with_skill was A in 4 of 9 pairs. A won 5 of 9,
so slot position did not track the winner. Comparators were allowed to read the
fixture to check claims, and several did.

## Result

**The baseline won 7 of 9.** Mean quality score 9.46 without the skill vs 9.19 with it
— a delta of **-0.27**, against iteration 3's rubric delta of **+0.25** on the same
eighteen reviews.

| pair | winner | with_skill | without_skill |
|---|---|---|---|
| account-service run-1 | baseline | 9.3 | 9.7 |
| account-service run-2 | baseline | 9.5 | 9.8 |
| account-service run-3 | baseline | 8.7 | 9.3 |
| posts-search-export run-1 | baseline | 9.0 | 9.3 |
| posts-search-export run-2 | baseline | 9.0 | 9.7 |
| posts-search-export run-3 | **with_skill** | 9.7 | 9.3 |
| post-page run-1 | baseline | 9.3 | 9.4 |
| post-page run-2 | baseline | 8.7 | 9.7 |
| post-page run-3 | **with_skill** | 9.5 | 8.9 |

## Why, and what it costs the iteration-3 story

The comparators' reasoning is consistent. The baseline wins on **breadth**, and the
extra findings are real: "catches five real issues B misses entirely", "ten findings
vs six", "four true findings B omits or footnotes". Where the skill arm won, it won on
**rigor**: "every claim I checked against the source held up", "proves reachability
with per-finding data-flow traces".

This directly damages a claim in `history/iteration-3/analysis.md`. That write-up
reported "signal density 61% vs 30%" and framed the baseline's extra findings as
noise. Signal there was defined as *is this one of my three planted issues* — and by
that definition anything else is noise by construction. The blind judges, reading the
same reviews with the fixture open, found most of those extras to be true defects the
fixture author did not plant. The LOW-discipline gate is still measuring something
real; what it is measuring is **obedience to the skill's stated policy**, not review
quality, and iteration 3 conflated the two.

## But the comparator is not a neutral arbiter either

Its rubric template is Content (correctness, completeness, accuracy) plus Structure
(organization, formatting, usability). **Completeness is a scored criterion; noise,
precision and reading cost are not.** A judge with that rubric will prefer the longer
review whenever the extra material is true, regardless of whether a human reviewing a
PR wants twelve items or five.

So the two instruments do not contradict each other about a fact. They encode
different definitions of a good review, and the disagreement localises exactly where
this skill's value is contested:

- **Rubric (iteration 3):** does the review follow the skill's reporting policy?
  Yes — 9 runs of 9.
- **Blind judge (iteration 4):** which review contains more verified true findings?
  The baseline — 7 pairs of 9.

Both are true. The open question is which one a reviewer on a PR queue actually wants,
and neither instrument answers it. That question needs the one part of skill-creator
still unused here: the human review loop (`eval-viewer/generate_review.py`), where the
user reads both outputs and says which they would rather receive.

## A third finding, free

Several comparators verified claims against the fixture by executing them, and found
**confidently-stated false claims in both arms**: a mangled RCE payload (`path.join`
collapses `https://` to `https:/`), a ReDoS attributed to the Node event loop when the
regex is evaluated by mongod, a `TypeError` claim disproved by running it. Neither the
hand grading nor the regex grader can catch a finding that is well-formed, correctly
located, and wrong. That is a whole failure mode both previous iterations were blind
to, and it argues for keeping a comparator or verifier in the loop permanently.

## What this changes

1. Do not cite "signal density" without saying what counts as signal. The iteration-3
   number is defensible only as "planted-issue density", not as a noise measure.
2. The `minPassRateDelta` gate in `evals.json` still guards something real, but the
   README claim that the skill "halves the findings list at the same recall" should
   not carry an implied "and that is better". Half the list is measurably less
   complete.
3. Worth adding as a permanent stage: a verifier that checks each finding's factual
   claims against the fixture. It is the only thing here that caught wrong-but-plausible
   findings, and it caught them in both arms.
