# skill-evals — agent guide

A/B harness measuring whether a skill in `.claude/skills` changes a review's outcome.
Not a test of this repo's product code.

## Before answering
Read `README.md`, then `.claude/skills/security/evals/README.md`, then
`history/iteration-3/analysis.md`. Three iterations of findings are already written
down — including two rubrics that measured the wrong thing and one broken trigger eval.
Do not re-derive them.

## Where things live
- **Cases, fixtures, answer key, gates** → `<skill>/evals/`, not here. They ship with
  the skill so it delivers as one directory.
- **Runner, history, results** → here. `run.ts` must stay skill-agnostic: everything
  case-specific belongs in `<skill>/evals/evals.json`.

## Conventions
- Own `package.json` and lockfile; not a workspace member (repo-wide convention).
- Node >= 22 (`fs.promises.glob`, used by `--grade-only`).
- `results/` is gitignored. Conclusions worth keeping go in `history/<iteration>/`.

## Do-not-touch
- `<skill>/evals/files/**` — the planted bugs and decoys are load-bearing. Editing a
  fixture invalidates every stored baseline in `history/`. Fixtures carry **no
  comments**: a comment hinting at a bug destroys the case.
- `<skill>/evals/answer-key.md` — never let an executor prompt reach it. `buildPrompt`
  forbids it and `evals.json` by absolute path; keep that if you rewrite the runner.

## After changing the rubric
Re-run `npm run grade -- results/security-workspace/iteration-3` and confirm it still
reports 100% vs 75%, 4.9 ± 1.1 vs 9.9 ± 1.3. That corpus is hand-graded; a divergence
means the grader changed, not the skill.

## Adding a case
Plant exactly three HIGH/CRITICAL issues that need a data flow traced, not a pattern
matched. Add decoys that look vulnerable and are correct. Decoy patterns must name the
control, not a keyword, or they over-match unrelated findings.
