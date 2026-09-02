# Shared fixtures

Fixtures that outlived the skill they were built for, or that more than one suite uses.
A suite points at one from its case:

```json
"files": ["../../../skill-evals/fixtures/mini-devdigest"]
```

(relative to `<skill>/evals/`), and copies `plants.json` into the case.

## mini-devdigest

21 files, four packages — `server`, `client`, `reviewer-core`, `e2e` — each carrying its
own `CLAUDE.md`. Built for `package-conventions`, which was measured and removed
(`history/iteration-10-package-conventions/`); the fixture is kept because the plants are
good and hard to build.

Every plant breaks a rule stated **only** in its package's guide and nowhere in the code,
and every one has a correct twin nearby. That combination — the violation reads as good
engineering, and a file doing the same job correctly sits next to it — is the shape that
actually discriminates between skill versions. Six plants, one of them a control that
needs no guide at all.

Use it to test any skill that claims to make a reviewer apply project conventions, or as a
template for a new fixture. The one caveat it produced is worth carrying into any such
skill: **a checklist narrows attention.** The first version of `package-conventions` found
all five convention violations and missed the plain unvalidated request body in every run,
while the arm without it caught that every time. If a review's findings all cite a written
rule, it is half a review.
