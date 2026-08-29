# mcp (@devdigest/mcp)

## Before answering
Read `mcp/README.md` (tool table, token budget, stdio contract) and `mcp/INSIGHTS.md`
before reading code.

## Conventions (not obvious from code)
- **stdout is the MCP wire.** Never `console.log` — diagnostics go to stderr only.
- **No uuid crosses the tool boundary.** Tools take `owner/name` + PR number + agent
  name; `src/resolve.ts` translates. Every resolve failure lists the valid alternatives.
- **No DB, no business logic.** This package only speaks REST to the DevDigest API.
  Needing a new capability means adding a route in `server/`, not reaching past it.
- `run_review` MUST call `GET /pulls/:id` before `POST /pulls/:id/review`, or the
  review runs against an empty diff and reports a false "approve / 100".
- Contracts come from `@devdigest/shared` as **`import type` only** (tsconfig path
  alias to `server/src/vendor/shared`). Never import a runtime zod schema from there —
  this package is on zod 4, the vendored contracts are zod 3.
- Adding a tool costs context for every session. Keep descriptions and each
  parameter's `.describe()` to one short line; cap the tool's output in `format.ts`.
  `test/context-budget.test.ts` fails the build if the budget slips.
- **The CLI must never grow its own reviewer.** `devdigest review` goes through
  `POST /reviews/diff` so it reuses `run-executor` — the grounding gate, agent
  selection, run trace and persistence are the production ones. If you find
  yourself importing `reviewer-core` here, stop: that is the second
  implementation the assignment forbids.
- `run_review` and the CLI share `src/review-wait.ts`. Both must agree on what
  "finished" means and on the poll backoff, which exists because of the API's
  120/min global limit.

## Use when
- Adding/changing a tool, token budgeting, transports → `mcp/README.md`
- Tool specs / acceptance criteria → `mcp/specs/<tool>/spec.md`
- The API routes a tool calls → `server/README.md` (API map)
- Why `run_review` warms the diff first → `server/INSIGHTS.md` (2026-08-02)
- Gotchas found while building this package → `mcp/INSIGHTS.md`
