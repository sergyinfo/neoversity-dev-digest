# Iteration 12 — which model can actually run this harness off-Anthropic

Goal: put the CI evals on a cheap model without changing what they measure. One case,
`react-render-and-app-config`, chosen because the Opus sweep gave it both a recall delta
(4/4 vs 3/4) and a strong reporting-discipline signal (baseline: 9 findings, 4 LOW).

## The route works

Claude Code drives OpenRouter's Anthropic-shaped endpoint on non-Anthropic models,
including real tool calls. `run.ts` needed no change for that. Two things around it did:

- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is **required**. The CLI defaults `max_tokens` to 32000
  for an unrecognised model id — every OpenRouter id is unrecognised — and OpenRouter runs
  its affordability check against `max_tokens`, not actual usage. Every request fails with
  HTTP 402 until the account can pre-fund 32000 output tokens, however short the real
  answer would be.
- The CLI's `total_cost_usd` is Claude-priced for an unrecognised id. A probe billed at
  $0.14 cost ~$0.026 on OpenRouter. The benchmark now labels that column off-Anthropic
  rather than reporting a 5x overstatement.

## Measured

Same case, same fixture, one run per arm.

| | Opus (sweep) | `anthropic/claude-haiku-4.5` | `deepseek/deepseek-v4-pro` | `google/gemini-3.6-flash` |
|---|---|---|---|---|
| with_skill | 4/4, 3 findings | 4/4, 3 findings | 4/4, 9 findings | 4/4, 4 findings |
| without_skill | 3/4, 9 findings, 4 LOW | 3/4, 3 findings, 0 LOW | 3/4, 5 findings, 2 LOW | not run |
| pass-rate delta | +0.25 | +0.25 | — | — |
| tokens per run | ~50k | 59k | 35k–147k | **574k** |
| wall clock | 145s | **28s** | 60–400s | 158s |
| runs that produced a review | 24/24 | 2/2 | **3/6** | 1/1 |

## What decided it

Not cost. `deepseek-v4-pro` is the repo guide's recommended cheap upgrade and was tried
first, but **half its runs ended the turn without ever calling `Write`** — `terminal_reason:
completed`, `is_error: false`, no error to catch. Once it did so after 17 tool calls, so it
is not stopping early; it fails to produce the final write.

That failure is not neutral between the arms. A run that writes nothing scores zero, and it
lands more often on the baseline — which has no step-by-step skill holding it on task —
so the harness would report a delta it never measured. A retry halves the rate; 25% still
cannot carry a 24-run job.

`haiku-4.5` reproduced Opus exactly, five times faster. It does report a weaker
LOW-discipline signal: its baseline was already disciplined (0 LOW against Opus's 4), so
the part of the security skill's effect that is reporting discipline will not show on this
model. Recall deltas transfer; discipline deltas may not.

`gemini-3.6-flash` works but costs ~10x the tokens and ~5x the wall clock of haiku for the
same task — prompt caching does not appear to survive this route. Kept for the repo-guide
check, which fires rarely and runs one case.

## Harness changes this forced

- a wall-clock cap per run (`EVAL_RUN_TIMEOUT_MIN`, default 15) — a gateway with no usable
  credentials hangs rather than fails, and four concurrent hangs would eat a CI job;
- the executor envelope is persisted when no review is written, otherwise the run directory
  is created empty and there is nothing to diagnose from;
- one logged retry (`EVAL_EXECUTOR_ATTEMPTS`, default 2), never silent.

## Open

Gate thresholds are still calibrated on Opus. Recall reproduced on haiku for one case; that
is not enough to keep the thresholds. Before the PR gates mean anything on haiku, re-run
the calibrated tier and set thresholds from it.
