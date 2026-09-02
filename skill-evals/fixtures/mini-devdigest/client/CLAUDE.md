# client (@devdigest/web)

## Before answering
Search `client/docs/`, `client/specs/`, `client/INSIGHTS.md` first.

## Conventions (not obvious from code)
- Types/contracts come from `@devdigest/shared` (Zod) — never hand-duplicate them.
  A local copy drifts silently the next time the contract changes.
- All API access goes through `src/lib/api.ts`. It carries auth, the workspace header
  and error normalisation; a bare `fetch` gets none of them.
