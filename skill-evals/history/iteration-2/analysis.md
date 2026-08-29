# Iteration 2 — analyst pass, and the comparison with iteration 1

Same protocol as iteration 1: Opus 5 (1M) both arms, one run per cell, 3 cases × 2 arms.
Two things changed: the plants now require tracing a data flow across a helper or a second
file, the decoys are code that *looks* like the vulnerable pattern but is correct — and a
sixth assertion measures signal density.

## Headline

| | iteration 1 | iteration 2 |
|---|---|---|
| assertions per case | 5 | 6 (added: signal density) |
| with_skill pass rate | 15/15 = 100% | **17/18 = 94%** |
| without_skill pass rate | 15/15 = 100% | **15/18 = 83%** |
| delta | +0.00 | **+0.11** |

The benchmark finally separates the arms. It separates them on exactly one assertion.

## Recall did not move. Again.

**9/9 planted issues found by both arms, in both iterations.** Six runs on fixtures built
specifically to defeat pattern-matching, and not one plant was missed:

| Plant | needs | with_skill | without_skill |
|---|---|---|---|
| `normalizeIdentifier` passes non-strings through → operator injection on login | open the helper, compare two call sites | HIGH | High |
| `requireAuth` missing `return`s → `next()` always runs | trace control flow | CRITICAL | High |
| `PATCH /me` picks a list that spreads in `['role','isActive']` | open a second config file | CRITICAL | Critical |
| `exec` sink safe from one caller, injectable from the other | compare both callers | CRITICAL | Critical |
| ownership compared against `req.body.authorId` | notice the operand's source | HIGH | Critical |
| `new RegExp(String(q))` — cast blocks operators, not metacharacters | know the cast is insufficient | HIGH | High |
| sanitized `safeBody` used only for the excerpt, raw body rendered | follow the variable | HIGH | Critical |
| CORS allowlist matched with `origin.endsWith(host)` | reason about the matcher | HIGH | High |
| `safeUrl` denylist instead of allowlist | recognise the wrong shape | HIGH | Medium |

Both arms also explicitly credited the strong decoys — the correctly-sanitized `CommentList`,
`remove()`'s atomic ownership filter, `create()` taking the author from the token, the
boot-time secret assert, `isValidObjectId` on the export routes, the clamped pagination.
**Zero decoy false positives in six runs, on either arm.** The precision assertion is as
non-discriminating as the recall ones.

## The whole delta is the noise assertion

| | eval-3 | eval-4 | eval-5 | total | planted / reported |
|---|---|---|---|---|---|
| with_skill findings | 7 | 5 | 5 | **17** | 9/17 = **53%** |
| without_skill findings | 12 | 10 | 9 | **31** | 9/31 = **29%** |

with_skill passes the ≤6-findings bar in 2 of 3 cases; the baseline fails it in 3 of 3.
That is the entire +0.11.

The 53% signal density is identical to iteration 1's — the skill arm reported 17 findings in
both iterations. The baseline dropped from 37 to 31, so the gap narrowed slightly (2.2× → 1.8×)
but held. The mechanism is unchanged: the skill's confidence table sends MEDIUM and LOW items
into a "notes / verified-safe" section instead of the findings list.

The one case where the skill arm failed the bar is eval-3, with 7 findings. All four extras
were real and unplanted — an unverified-email account state, `skipSuccessfulRequests` making
the shared limiter useless on `/register`, a password reset that leaves other outstanding
tokens redeemable, and an unvalidated `avatarUrl`. Two of those are bugs the fixture author
wrote by accident. Filing them was correct; the assertion is a blunt instrument.

## Cost

| | it-1 with | it-1 without | it-2 with | it-2 without |
|---|---|---|---|---|
| subagent tokens (mean) | 53,846 | 39,773 | 54,335 | 44,527 |
| wall clock (mean) | 140.5 s | 148.9 s | 177.2 s | 176.3 s |
| review length (mean chars) | 14,941 | 18,505 | 17,639 | 20,235 |

Harder fixtures cost both arms ~25% more wall clock. The skill's token premium narrowed from
+35% to +22%: the baseline had to work harder on these fixtures, while the skill arm's overhead
is a fixed cost (reading SKILL.md and its bundled files) that does not scale with difficulty.

## What this says about the skill

On an Opus-class model the `security` skill does not change **what** gets found — not on
textbook patterns, and not on plants built specifically to require data-flow tracing. What it
changes is **what gets reported**: roughly half the findings, at the same recall, with severity
anchored to its own table.

That is a real effect and it is worth something on a PR queue — a 5-item review gets read, a
12-item review gets skimmed. But it is a reporting-discipline skill, not a detection skill, and
the eval should be honest about which axis it measures.

## Eval critique — what iteration 3 should change

1. **Stop testing recall on this model.** 18/18 planted issues found across two iterations.
   Either move to a weaker model where recall has room to vary, or drop the recall assertions
   to one sanity check and spend the budget elsewhere.
2. **The precision assertion has never fired.** Zero decoy hits in twelve runs. Either the
   decoys need to be genuinely ambiguous (a pattern that is *arguably* a finding), or the
   assertion should be retired.
3. **Replace the ≤6 hard cap.** eval-3 shows it punishes a correct review for finding real bugs
   the fixture author did not intend. Better: "every reported finding is HIGH confidence per the
   skill's own table", graded against the finding's own severity label.
4. **Still one run per cell.** The 94% ± 10% is one failure in three, not a variance estimate.
   Three runs per cell would settle whether the eval-3 overshoot is stable or noise.
5. **Test the trigger, not just the body.** Both iterations force the skill to load. Nothing
   here measures whether `security` fires on its own when someone says "review this PR" —
   skill-creator has `scripts/improve_description.py` for exactly that, and it is the untested
   half of the skill.
