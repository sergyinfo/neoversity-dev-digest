# Iteration 8 — dependency-checker, with skill vs without. A negative result.

New skill, so the baseline is "no skill". The fixture is **this repository** rather than
a synthetic one — the thing the skill was written for. Both arms got Bash, or the run
would have measured tool access instead of the skill. 5 runs per arm.

Plants were verified by hand before the run: `mcp` is on zod ^4.2.0 while the vendored
contracts it aliases are ^3.24.1; `e2e` carries two lockfiles; neither `mcp` nor
`reviewer-core` declares `@devdigest/shared`. A fourth plant, `exclusive-vs-total`, asks
whether the report separates what a dependency drags in from what removing it frees.

## Result

| Metric | with_skill | without_skill |
|---|---|---|
| Pass rate | 75% | 75% |
| Findings per review | **9.0 ± 0.0** | **14.2 ± 0.7** |
| Tokens | 129.0k | 118.4k |
| Wall clock | 500s | 497s |
| Cost | $14.09 | $12.51 |

| Category | with_skill | without_skill | Delta |
|---|---|---|---|
| repo-invariant | 60% | 60% | **+0.00** |
| method (`exclusive`) | 100% | 20% | +0.80 |

## The knowledge section did not earn its keep

Hand-verified, not taken from the counter:

- The zod major mismatch across the alias boundary: **5/5 both arms**.
- The two lockfiles in `e2e`: **5/5 both arms**.
- The alias-only dependency: missed by both, and that is my fault, not the model's —
  `SKILL.md` never asks anyone to check that an alias target is also declared. The plant
  tests something the skill does not teach.

The baseline reached the same repo facts with Bash and half an hour. It also produced
findings the skill arm did not: `@fastify/autoload` declared as a production dependency
with zero importers; `e2e` depending on an external binary declared nowhere; several SDKs
far enough behind to matter. And it independently arrived at P1/P2/P3 tiering — a
structure the skill prescribes and the baseline invented.

## The one measured win does not count, and I said so before the run

`exclusive` scored 100% vs 20%. That number comes from `scripts/scan.mjs`, which only the
skill arm has. It measures **tooling, not the skill's text** — a bundled script is a real
contribution, but crediting it as evidence that the written rules help would be dishonest.
Discounted deliberately.

## What did move

Output stability. The skill arm produced **exactly 9 findings in all five runs** against a
13–15 spread without it, and followed the prescribed five-section shape every time. That
is the same reporting-discipline effect the `security` skill showed, and it is worth
something to a reader who wants two audits to be comparable.

It cost 13% more tokens and $1.58 more per run to get it. Unlike onion v3, this skill did
not make the work smaller.

## Six wording misses, and a guard against myself

`alias-only-dependency` was missed by patterns six times in a row across this session —
the reports say "not a dependency", then "neither is a declared dependency", each time a
phrasing the regex did not carry. Widening the pattern while watching the output is how an
eval quietly starts fitting its own skill, so the protocol was: choose the pattern after
both arms finish, apply it identically, and let the hand-read text be the primary number.
Probed on both arms, `declared depend` scored 3/5 vs 2/5 — no separation. There is no
honest pattern here because there is no effect to find.

## What to change

1. **Add the check the skill is missing**: for every tsconfig alias, verify the target is
   also a declared dependency, and say what happens at runtime when it is not.
2. **Stop counting `method` in the gate.** A plant that only the bundled script can satisfy
   flatters the skill. Move it to a reported metric.
3. The knowledge section should be cut to what the baseline did *not* derive. On this
   evidence that is very little — possibly only the "not a finding" list, which is what
   stops a reviewer reporting the no-workspace duplication as waste.
