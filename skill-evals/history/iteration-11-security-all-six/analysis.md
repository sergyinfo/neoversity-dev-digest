# Iteration 11 — all six security cases, two runs per arm

First full-scale exercise of the runner: both tiers in one invocation, 6 cases x 2 arms
x 2 runs = 24 executor runs. Also the first run under the new two-run default.

| Metric | with_skill | without_skill |
|---|---|---|
| Pass rate | **98%** | 83% |
| Recall (all plants found) | 100% | 100% |
| LOW discipline | **92%** (11/12) | 42% (5/12) |
| Findings per review | **5.1 ± 1.7** | 10.3 ± 3.2 |
| Signal density | 59% | 29% |
| Tokens / wall clock | 49.1k / 147s | 28.0k / 138s |
| Cost | $8.55 | $5.62 |

$14.17 for twenty-four runs — half the estimate, and cheaper than the five-run matrix of a
single case in iteration 7. Zero environment failures: closed stdin, judging by output
rather than exit code, and concurrency 3 all held.

## Two runs per arm is enough to screen

Iteration 3 measured the data-flow tier at 100% vs 75% with n=3 and hand grading. Six
cases at n=2 give 98% vs 83% — same direction, same order of magnitude. The screening
protocol works; five runs stay reserved for a small delta that decides something.

The arms differ in a way n=2 shows clearly: **the baseline's spread is twice the skill's**
(± 3.2 against ± 1.7). On `auth-jwt-mongo` the baseline produced 10 findings in one run
and 14 in the other; the skill produced 6 and 7. On two cases the skill produced an
identical count both times.

## A correction to iteration 1

Iteration 1 recorded that the textbook tier shows no delta. That was a statement about the
**rubric**, not the cases. It measured recall only, and recall there is 100% in both arms.
On the same fixtures today, with assertions that also catch noise and false positives:
**the skill takes 6 of 6 full marks, the baseline 1 of 6.** The cases were fine.

## Three defects this run exposed

**The self-scoring guard fired on the oldest suite.** Nine of security's plant patterns
match the security SKILL.md's own text — `req\.body\.email` against "Cast input types
explicitly: `String(req.body.email)`", `jwt\.decode` against the A07 table row,
`dangerouslySetInnerHTML` against "Never use dangerouslySetInnerHTML without DOMPurify". A
review reciting the skill scored on them. The +0.25 from iteration 3 survives, because it
came from LOW discipline rather than recall and the baseline never reads the skill — but
"27/27 plants found" for the with_skill arm has to be read with that caveat.

**The `buildThumbnail` decoy is malformed.** The baseline filed "`buildThumbnail` is
exported but unreferenced" and was marked as a false positive. The observation is *true* —
nothing in the fixture calls it. The decoy was meant to punish calling `execFile` with an
argument array unsafe, and punished a correct remark instead. Fixture defect, not review
defect. First time in thirty-odd runs that a decoy fired at all, and it was wrong.

**Gate messages rounded away their own argument.** The failure printed
`pass-rate delta 0.15 < 0.15`. The real delta is 0.1458 — displayed at two decimals,
compared at full precision. Gate messages now carry four decimals and a run count.

## Both gates failed, and both thresholds are the problem

- `pass-rate delta 0.1458 < 0.15` — four thousandths short of a threshold set by eye on
  three cases hours earlier.
- `LOW discipline 0.9167 < 1` — one slip in twelve runs, on `account-service-flows`, the
  case whose fixture contains more real bugs than planted ones. The baseline scores 4/4
  there with 14–16 findings and zero LOW: it is not padding, it is finding real defects I
  wrote by accident. That case drags the delta down legitimately and should be re-planted
  or cleaned.

Calibrated on three cases, these gates are too strict for six.

## What twenty-four runs confirm

Recall 100% in both arms — the eighth confirmation that this skill adds no detection. LOW
discipline 92% against 42%, and half the spread. **A predictability instrument, not a
detection one**, now on a sample that deserves the name.
