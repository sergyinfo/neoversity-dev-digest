# evals Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.

---

## What Works

## What Doesn't Work

2026-09-02 — `subscriptionEnv()` deletes the credentials but NOT `ANTHROPIC_BASE_URL`, so an inherited base URL silently redirects a subscription run to a foreign endpoint with no auth. The default (`subscription`) branch removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` and returns; if the shell already exported `ANTHROPIC_BASE_URL` (normal after any OpenRouter work), every request goes there unauthenticated and **hangs** rather than failing — two consecutive runs died at exactly `240.01s`, the vitest `testTimeout`, with `no records — run crashed` and no error to read. Either `unset ANTHROPIC_BASE_URL` before a subscription run, or set `EVAL_BACKEND=openrouter` and let the function build the whole env itself. ref: src/runtime/env.ts:26

2026-09-02 — Quality cases judge a truncated run as if it were complete: the quality path never checks `result.isError`. `run-claude.ts` sets `isError = msg.subtype !== "success"`, so a run that blows `maxTurns` is flagged — but the flag is only asserted in the trace branch (`case.ts:188`), while the quality branch goes straight from the task to `llmJudge`. A run cut off mid-report is therefore scored on a partial answer, and the resulting low score looks like a quality regression rather than a truncation. ref: src/dsl/case.ts:102

## Codebase Patterns

2026-09-02 — The judge must NOT be the same model as the task, and the workflow used to override that silently. `config.ts` defaults `EVAL_JUDGE_MODEL` to `claude-sonnet-5` and `llm-judge.ts` states the judge "defaults to a stronger family than the task to soften single-model self-preference", but `evals.yml` pinned `EVAL_JUDGE_MODEL` to the same `tool_model` input as the executor, collapsing both onto Haiku. Evidence it matters: two CI runs of `architecture-reviewer` with a byte-identical agent and identical execution — 21 turns, 20 tool calls, `ok` in both — scored 1.0 and then 0.5. `judge_model` is now its own workflow input for exactly this reason; keep it separate. ref: src/config.ts:10

2026-09-02 — Agent cases are non-deterministic unless the prompt names the docs the agent is required to cite. `agentTask` runs with `settingSources: []` (no CLAUDE.md, no skills), so an agent whose hard rules forbid judging without the repo's documented contracts has to locate them itself via Glob/Grep from the repo root. Whether it succeeds is luck: across four CI runs the same `architecture-reviewer` case spent 10, 13 and 21 tool calls and passed, then spent 3, replied "I cannot cite them as violations without the repo's own documented contracts", and scored 0/6 — with nothing changed between the runs. Name the doc paths in the prompt; it gives away no answer, since the agent still has to read them, map the diff and pick the rule identifier. ref: src/runtime/run-claude.ts:70

## Tool & Library Notes

2026-09-02 — `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is mandatory, not tuning, when `EVAL_BACKEND=openrouter` routes the Agent SDK straight at OpenRouter. The CLI defaults `max_tokens` to **32000 for any model id it does not recognise**, and every OpenRouter slug is unrecognised; OpenRouter runs its affordability check against `max_tokens` rather than actual usage, so every request fails with `API Error: 402 … You requested up to 32000 tokens, but can only afford N` no matter how short the real answer would be. The failure carries `duration_api_ms: 0` and zero usage, which reads like an auth wall. Setting it to 16000 still fits a full review. ref: src/runtime/env.ts:26

2026-09-02 — `deepseek/deepseek-v4-pro` cannot back a tool tier: it ends its turn without ever calling the tool that produces the artifact. Measured 3 of 6 runs producing no output file, on both arms of an A/B, with `terminal_reason: completed`, `is_error: false` and no error to catch — once after 17 tool calls, so it is not stopping early but failing to perform the final write. This is a different defect from the "too noisy on borderline scoping cases" already noted for cheap OSS models in `evals.yml`, and it is worse for an A/B: a run that writes nothing scores zero and lands more often on the unstructured arm, inflating the delta. `anthropic/claude-haiku-4.5` reproduced the Opus result on the same case at a fifth of the wall clock. ref: .github/workflows/evals.yml:11

## Recurring Errors & Fixes

## Session Notes
