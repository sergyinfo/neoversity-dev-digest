# Iteration 3 — analyst pass, and the three-iteration picture

Same fixtures as iteration 2 (they were never the problem). What changed: the rubric, the
sample size, and an attempt to measure the skill's trigger.

- **Rubric:** four assertions per run — recall (all three plants), precision (no correct control
  filed as a finding), **LOW discipline** (nothing rated LOW/Info inside the findings list — the
  skill's own "LOW → do not report" rule), and report format. The iteration-2 hard cap of
  "≤6 findings" is gone; signal density is now a measured number, not a pass/fail.
- **Sample:** n=3 per cell. Iteration-2's outputs are run-1 (identical prompts, fixtures and
  model); runs 2 and 3 are new. 18 runs total.
- **Verification:** plants and severities were confirmed by pattern-matching the review text,
  not by trusting each executor's self-reported summary.

## Result

| | with_skill | without_skill |
|---|---|---|
| assertions passed | **36/36 = 100%** | **27/36 = 75%** |
| recall (planted issues found) | 9/9 runs, 3/3 each | 9/9 runs, 3/3 each |
| precision (no decoy filed as broken) | 9/9 runs | 9/9 runs |
| LOW discipline | **9/9 runs** | **0/9 runs** |
| format | 9/9 runs | 9/9 runs |

**Delta: +0.25, and every point of it is the LOW-discipline assertion.** It is the first
assertion in three iterations that separates the arms perfectly and does so on every single run.

## Findings volume, now with variance

| | run-1 | run-2 | run-3 | mean | sd |
|---|---|---|---|---|---|
| with_skill, eval-3 | 7 | 5 | 6 | 6.0 | |
| with_skill, eval-4 | 5 | 3 | 5 | 4.3 | |
| with_skill, eval-5 | 5 | 4 | 4 | 4.3 | |
| **with_skill, all** | | | | **4.9** | **1.1** |
| without_skill, eval-3 | 12 | 12 | 10 | 11.3 | |
| without_skill, eval-4 | 10 | 9 | 8 | 9.0 | |
| without_skill, eval-5 | 9 | 9 | 10 | 9.3 | |
| **without_skill, all** | | | | **9.9** | **1.3** |

44 findings against 89 — the baseline reports **2.0× more**, and the gap is far larger than the
run-to-run spread (sd ≈ 1.1–1.3 in both arms). This is a stable effect, not the artefact of a
single lucky run that iteration 2's n=1 could not rule out.

Signal density: 27/44 = **61%** with the skill, 27/89 = **30%** without.

The mechanism is now precisely located. Both arms *notice* roughly the same things; the baseline
files 3–5 LOW-severity items per review into the findings table, and the skill arm moves the same
material into a "notes / lower confidence / verified-safe" section. Nine runs out of nine, on
both sides. That is the skill's confidence table doing exactly what it says.

## Cost, all three iterations

| | it-1 with | it-1 base | it-2 with | it-2 base | it-3 with | it-3 base |
|---|---|---|---|---|---|---|
| tokens (mean) | 53,846 | 39,773 | 54,335 | 44,527 | 54,309 | 43,672 |
| time (mean) | 140 s | 149 s | 177 s | 176 s | 180 s | 170 s |
| findings (total) | 17 | 37 | 17 | 31 | 44 (n=3) | 89 (n=3) |

The skill's token cost is remarkably stable at ~54k across all three iterations — it is a fixed
overhead (reading SKILL.md plus bundled files), independent of fixture difficulty. The baseline
rises with difficulty (39.8k → 44.5k → 43.7k), so the premium narrowed from +35% to +24%.

## The trigger eval did not measure the trigger

20 queries × 3 runs through `skill-creator/scripts/run_eval.py`: **0 triggers out of 60**,
including on "Is it safe to render post content with `dangerouslySetInnerHTML`?" and "Write the
JWT auth middleware for my Express API". A uniform zero across every positive is a broken
measurement, not a property of the skill.

Cause, read from the script: `run_single_query` does not install the skill. It writes a **slash
command** into `.claude/commands/<skill>-skill-<uuid>.md` carrying the skill's description, then
runs `claude -p <query>` and watches the stream for that command being invoked. A slash command
does not enter the model's available-skills list the way a real skill does, so nothing fires
regardless of the query. The reported "10/20 passed" is an artefact: all ten negatives "passed"
because nothing triggered, and all ten positives failed for the same reason.

The harness cleaned up after itself — no stray files under `.claude/commands/`.

**The skill's trigger therefore remains unmeasured after three iterations.** Measuring it needs a
different rig: run `claude -p` inside a project where `security` is genuinely installed, and grep
the session transcript for a read of `SKILL.md`.

## What three iterations establish

1. **Recall is saturated.** 27/27 planted issues found, by both arms, across textbook patterns
   (iteration 1) and plants built to require cross-file data-flow tracing (iterations 2–3). On an
   Opus-class model this skill adds no detection.
2. **Precision was never at risk.** Zero decoy false positives in 30 runs, both arms. The
   assertion can be retired.
3. **The skill is a reporting-discipline instrument.** Same findings, half the list, LOW items
   filed as notes instead of findings, severities anchored to its own table. Worth ~24% more
   tokens if a shorter review is worth something on your PR queue.
4. **The eval measured the wrong thing twice before measuring the right thing once.** Iteration 1
   asked whether the skill finds more (+0.00). Iteration 2 asked whether it reports less, with a
   blunt cap that punished a correct review (+0.11). Iteration 3 asked the same question against
   the skill's own stated rule and got a clean separation (+0.25).

## What iteration 4 would need

- A weaker model. Everything above is a statement about Opus 5, not about the skill in general.
  Re-running the same 18 cells on Haiku is the single highest-value next experiment: it is the
  only way to find out whether the skill adds recall where recall has room to move.
- A working trigger rig (above). Under-triggering is the failure mode skill-creator itself warns
  about, and it is still untested here.
- Drop the recall and precision assertions to one sanity check each; they have cost 30 runs and
  produced no signal.
