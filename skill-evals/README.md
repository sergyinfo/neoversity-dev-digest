# skill-evals

The A/B harness for the skills in `.claude/skills`. **The test cases are not here** —
they live with each skill (`<skill>/evals/`) so a skill can be delivered as one
self-contained directory. This package is the runner, the history and the gates.

For the security corpus, read `.claude/skills/security/evals/README.md` first.

## Run it

```bash
npm ci
npm run eval:smoke                # 1 case, 1 run per arm — a few minutes
npm run eval:security             # data-flow tier, 3 cases x 2 arms x 3 runs
npm run eval:textbook             # the iteration-1 corpus
npm run grade -- <results-dir>    # re-score existing reviews, no model calls
```

Flags: `--skill <name|path>` (bare name resolves under `.claude/skills`), `--tier`,
`--cases a,b`, `--runs`, `--model`, `--concurrency`, `--out`, `--grade-only <dir>`.

Adding a second skill's evals needs no change here: put an `evals/evals.json` in that
skill and run `--skill <name>`.

## How the arms are built

Each case runs twice. The with-skill arm is told to read `<skill>/SKILL.md` and follow
it; the baseline is told not to read anything under `.claude/skills` and to rely on its
own knowledge. Both get the identical task, fixture and output path.

The runner gates on the **delta**, not the absolute score — a skill that changes
nothing scores the same in both arms and fails.

Executors run as `claude -p --restricted --allowed-tools "Read Glob Grep Write"
--permission-mode acceptEdits`. `--restricted` drops Bash and the other code-running
tools; note that `bypassPermissions` is *rejected* in restricted mode, so `acceptEdits`
is the mode that actually works.

## What the rubric checks

| Assertion | Why |
|---|---|
| All planted issues reported | recall |
| No correct control filed as a finding | precision |
| No LOW/Info item in the findings list | the skill's own rule is "LOW → do not report" |
| At least one severity-labelled finding | catches an empty or malformed review |

Findings are counted inside the *findings region* — everything before the first
"not counted as findings" / "verified safe" style heading. Both arms park
below-the-bar material under such a heading, and counting it would erase the exact
difference the suite exists to measure. Each finding is also listed twice in most
reviews (a summary-table row and a section heading), so the two shapes are tallied
separately and the richer one wins rather than being summed.

## The grader is validated, and it is not infallible

`--grade-only` reproduces the hand-grading in `history/iteration-3/` exactly:

```
Pass rate       100% vs 75%      delta +0.25
Recall          100% vs 100%
LOW discipline  100% vs 0%
Findings/review 4.9 ± 1.1 vs 9.9 ± 1.3
Signal density  61% vs 30%
```

Re-run it after any rubric change:
`npm run grade -- results/security-workspace/iteration-3`

**Read "signal density" as "planted-issue density", not as a noise measure.** Signal
there means *is this one of the three plants*, so everything else counts as noise by
construction. Blind judges reading the same reviews with the fixture open found most of
those extras to be real defects nobody planted, and preferred the baseline in 7 pairs of
9 — see `history/iteration-4-blind/`. The rubric and that judge measure different things
and disagree; neither has been settled against a human reader.

Its known weakness is the precision check, which matches decoy patterns against
finding titles. A bare keyword over-matches: `bcrypt` once tripped on the unrelated
finding "`/register` is unauthenticated and unthrottled — account spam + bcrypt CPU
DoS". Decoy patterns must name the **control** (`bcrypt.{0,25}(cost|round|12)`), not a
keyword. If a precision failure looks wrong, check the pattern before the review.

## Cost

The full matrix is 18 model runs — measured at ~0.9M tokens and about $15 on Opus. That is why the CI workflow is
`workflow_dispatch` + weekly `schedule` and not a per-PR check — unlike every other
workflow in this repo, which is deliberately keyless and deterministic. Its most
valuable trigger is a push to `skills-lock.json` or `.claude/skills/**`: skills are
vendored from other people's repos, and an upstream rewrite could remove the only
effect this skill actually has.

## Layout

```
run.ts                runner, grader, gates — suite-agnostic
history/              analysis.md + benchmark.md per iteration, kept in git
results/              run output — gitignored
```

Conclusions worth keeping go in `history/<iteration>/`; `results/` is disposable.
