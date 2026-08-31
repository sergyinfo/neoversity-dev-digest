# security — evals

Test cases for this skill, kept inside it so the skill delivers as one directory.
The runner lives separately in `skill-evals/` and is not needed to read or edit these.

```
evals/
  evals.json     cases, prompts, expectations, plant signatures, decoy patterns, gates
  answer-key.md  what is planted and what is a decoy — graders only, never an executor
  files/         the code under review
  trigger-eval/  query set for skill triggering (unmeasured — see below)
```

`evals.json` is readable by skill-creator (`skill_name`, `evals[].{id,prompt,
expected_output,files,expectations}`). The `tier`, `plants`, `decoys` and `gates`
fields are extra and are what `skill-evals/run.ts` grades on.

## The two tiers

- **textbook** — canonical OWASP patterns, recognisable on sight. Both arms score
  100% on recall here. Kept as valid cases; not run by default.
- **data-flow** — every plant needs a flow traced across a helper or a second file
  (a sanitizer that returns non-strings unchanged, a sink that is safe from one
  caller and injectable from another, a sanitized value used only for an excerpt).
  Every decoy is code that looks vulnerable and is correct. **The gates are
  calibrated on this tier.**

Each fixture holds exactly three planted HIGH/CRITICAL issues. Fixtures carry **no
comments** — a comment hinting at a bug destroys the case.

## What these cases established

Across three iterations, 27/27 planted issues were found by both arms. The skill does
not change what an Opus-class model finds; it changes what gets reported — half the
findings at the same recall, LOW items filed as notes rather than findings, in 9 runs
out of 9. That is why the gate that matters is `withSkillLowDiscipline`, not recall.

Two later passes qualify that. A blind pairwise judge, given the same reviews with no
assertions, preferred the **baseline** in 7 pairs of 9 — it scores completeness and the
extra findings are largely true, so "half the findings" is not automatically better. And
a grader agent, checking claims by executing them, found at least one confidently stated
**wrong** claim in every report it read, in both arms — something no assertion here can
see. Full write-ups, including the rubric's own weaknesses: `skill-evals/history/`.

## Running them

```bash
cd skill-evals
npm ci
npm run eval:smoke        # one case, one run per arm
npm run eval:security     # data-flow tier, 3 runs per arm (~$15 on Opus)
npm run grade -- <dir>    # re-score existing reviews, no model calls
```

## Two things to know

**The answer key sits next to SKILL.md.** The with-skill arm is told to read this
directory, so `run.ts` explicitly forbids `answer-key.md` and `evals.json` by path in
every prompt. Keep that constraint if you write another runner.

**`files/**` is deliberately vulnerable** — working RCE, IDOR, NoSQL injection and
stored XSS. Exclude this path from CodeQL, dependabot and this project's own reviewer
before pointing any of them at the repo.

## Known gap: triggering

`trigger-eval/` holds a 20-query set, but skill-creator's `run_eval.py` cannot measure
it — it does not install the skill, it writes a slash command carrying the skill's
description and watches for that command being invoked. A slash command does not enter
the available-skills list, so nothing fires: 0 triggers out of 60, positives included.
`trigger-eval/results.json` is that artefact, kept only so nobody re-runs it expecting
an answer.
