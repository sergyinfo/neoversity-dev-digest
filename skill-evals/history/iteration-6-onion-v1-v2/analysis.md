# Iteration 6 — onion-architecture v1 vs v2. The added rules changed nothing.

First use of skill-creator's second comparison axis: baseline is a frozen earlier version
of the same skill, not "no skill". 3 cases x 2 arms x 2 runs = 12 runs, Opus.

**v1** — generic Onion: rings, the dependency rule, ports and adapters, review procedure.
**v2** — v1 plus one section, +42 lines, encoding three DevDigest conventions from
`server/CLAUDE.md`: modules do not import each other's internals, repo-intel only through
`container.repoIntel.*`, registration is one static line in `modules/index.ts`.

Nine plants across three fixtures, each tagged `ring` (a plain dependency-rule violation
both versions should catch — the control) or `module` (a boundary rule only v2 states).

## Result

| Category | v2 | v1 | Delta |
|---|---|---|---|
| `ring` (control) | 100% | 100% | +0.00 |
| `module` (the experiment) | 100% | 100% | **+0.00** |

The gate `minCategoryRecallDelta: {module: 0.5}` failed, as it should have.

## The premise was wrong, and the text says so

The bet was that a repo-specific convention is knowledge the model cannot guess. v1 found
every module-boundary plant, in every run, and reasoned about it correctly without ever
having been told the rule:

> "To be precise about the arrow: both targets are application-ring, so these are
> *lateral*, not outward. They do not break the dependency rule, and I am not reporting
> them as such. They do break the module boundary."

v1 derived the concept of a module boundary from the code, separated it from the
dependency rule on its own, and proposed the same remedy v2 prescribes — express the need
as an interface in `contract.ts` and inject at the composition root. The filesystem
autoload plant was likewise caught by all four v1 runs.

So "written in CLAUDE.md" is not the same as "underivable". A convention that exists
because the code would otherwise be obviously worse is one a competent reader
reconstructs. What a skill can add is a rule whose *reason* is invisible — where the
violating line looks correct and the failure is silent.

## Two harness bugs this run exposed

- **`--out` accepted a relative path.** The executor runs with `cwd` at the repo root
  while the runner resolved the same relative path against `skill-evals/`, so twelve
  executors wrote twelve reviews the runner then reported as "wrote no review". The
  committed CI workflow passes a relative `--out`, so every CI run would have failed the
  same way. `--out` is now resolved against the harness directory.
- **The findings tally did not recognise `## Finding 1 — ...` headings**, scoring a
  complete 167-line review as zero findings. The heading pattern was widened.

Also noted, not fixed: for an architecture review two of the four rubric assertions are
vacuous. There are no severity labels in this domain, so "no LOW in the findings list"
passes without meaning anything. The rubric was written for the security suite and
carried over without being re-examined.
