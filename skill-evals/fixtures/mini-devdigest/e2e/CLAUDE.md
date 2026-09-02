# e2e (@devdigest/e2e)

## Before answering
Search `e2e/docs/`, `e2e/specs/`, `e2e/INSIGHTS.md` first.

## Conventions (not obvious from code)
- **Flows are deterministic; no LLM is called** — behaviour is stable across runs, and a
  failure always means the app changed. A model call makes a red build unfalsifiable.
