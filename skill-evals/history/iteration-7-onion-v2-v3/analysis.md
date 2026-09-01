# Iteration 7 — onion v2 vs v3. One rule out of three earned its keep.

Baseline is the frozen v2 (rings + module boundaries). v3 adds one section, +45 lines:
three invariants from `mcp/CLAUDE.md` chosen against a stricter criterion than iteration 6
used. Not "is the rule repo-specific" — iteration 6 showed that is not enough — but **is
the reason invisible in the file, and is the failure silent**.

Fixture: `case-4-mcp-review-tool`, 15 files, 403 lines — three times the previous ones.
Six plants: three `invariant` (the delta) and three `ring`/`module` (controls). Every
invariant plant has a near-identical **correct twin** in the same package, so pattern
recognition alone is not enough.

**5 runs per arm**, the first time this suite has enough samples to talk about a rate.

## Result

| Metric | v3 | v2 |
|---|---|---|
| Pass rate | 100% | 70% |
| Runs finding every plant | 5/5 | **0/5** |
| Findings per review | 6.4 ± 0.8 | 9.0 ± 1.5 |
| Tokens / wall clock / cost | 40.8k / 139s / $3.11 | 47.9k / 223s / $3.98 |

Controls flat: `ring` 100%/100%, `module` 100%/100%. Whatever moved was the new section.

| Plant | v3 | v2 |
|---|---|---|
| `run_review` never warms the diff | **5/5** | **0/5** |
| Value import of a vendored contract | 5/5 | 0/5 by the invariant's own reasoning |
| `console.log` on the stdio wire | 5/5 | 5/5 |

Invariant recall 100% vs 33%, **delta +0.67**.

## The interesting failure

v2 did not overlook the two review tools — it compared them and drew the wrong
conclusion:

> "`rerun-review.ts` is a near-copy of `run-review.ts`" (run-3)
> "`rerun_review` is `run_review` copied" (run-5)

It looked straight at the one line of difference — the missing `GET /pulls/:id` — and
read it as duplication. Not one of the five runs mentions an empty diff or a false
"approve / 100". v3 leads with it in all five.

That is what an underivable rule looks like: the evidence is fully visible and means
nothing without the reason.

`console.log` on an MCP stdio server, by contrast, is common knowledge — every v2 run
reported it, several as a release blocker. Writing it down bought nothing.

## The measurement understated the result, again

The first automated pass reported invariant delta **+0.33** and failed the gate. That was
a bad plant pattern: `reviewRequestSchema` matched any mention, and v2 mentions it inside
a *different* finding — that the `@devdigest/shared` path alias resolves at compile time
and a value import will crash at runtime. That finding is true, and its remedy is the same
`import type`, but the mechanism is unrelated to the zod-major mismatch the invariant is
about. Right line, wrong reason — the class the grader agent identified in iteration 5.

Pattern tightened to `zod ?v?3`, the actual discriminator: only v3 ever reasons about the
vendored copy's zod major. Re-graded: +0.67, gates pass.

Third consecutive iteration in which a regex signature misled the headline number and only
hand-verification caught it. The rule now has a name: **a plant pattern must match the
reasoning, not the identifier.** An identifier appears in correct findings, in decoy
discussions, and in "checked and fine" sections.

## Cheaper and faster, for once

v3 used 15% fewer tokens and 38% less wall clock. The three explicit passes it prescribes
("grep the imports for value imports; find every review POST and check what precedes it;
grep for console.log") are cheaper than reading fifteen files hoping to notice. This is
the first version in this project where the skill made the work smaller rather than larger.
