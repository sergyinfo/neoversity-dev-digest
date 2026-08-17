# Insights — reviewer-core

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-14** — `reviewPullRequest` already returns `tokensIn`/`tokensOut`/`costUsd` in `ReviewOutcome` — consumers wanting cost should READ it from the outcome, not recompute (zero extra model calls). Cost is accumulated per chunk and goes `null` if ANY chunk lacked a cost (conservative). The OpenRouter provider prefers the real `usage.cost` and falls back to `estimateCost`. Evidence: `reviewer-core/src/review/run.ts:110,184`, `src/llm/openrouter.ts`.
- **2026-08-17** — Adding an optional prompt section is a FOUR-file recipe, and the omit-when-empty guard must be `parts.x && parts.x.trim().length > 0` — not truthiness — or a whitespace-only value emits a heading (matching `repoMap` at `src/prompt.ts:111` and `callers` at `:115`). The four edits: `PromptParts` + the `userSections.push` in `src/prompt.ts`, `ReviewInput` + `promptParts` in `src/review/run.ts:130`, a **`nullish()`** slot on `PromptAssembly` in the vendored `contracts/trace.ts` (nullish is load-bearing — `server/.../run-executor.ts:445` builds a partial assembly for failed runs), and a conditional spread at the call site. `test/prompt.test.ts` has the byte-identity test template.
- **2026-08-17** — `src/review/run.ts:22` already documents that the engine does no "DB, GitHub, fs, memory retrieval, **intent**, or persistence". Anything intent-shaped must therefore arrive as an already-resolved STRING; deriving it inside the engine would break the no-I/O iron rule. The Intent Layer follows this — the server renders the block (`server/src/modules/intent/block.ts`) and passes it in.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
