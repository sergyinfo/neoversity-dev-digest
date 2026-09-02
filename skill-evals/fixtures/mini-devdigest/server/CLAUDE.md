# server (@devdigest/api)

## Before answering
Search `server/docs/`, `server/specs/`, `server/INSIGHTS.md` for the topic before reading code.

## Conventions (not obvious from code)
- Multi-tenancy: every domain table has `workspace_id`; queries are scoped by the base-repository guard.
- DI via `src/platform/container.ts`: services depend on interfaces, not classes.
- repo-intel is reached ONLY through the facade `container.repoIntel.*` — never touch the pipeline directly.
- **Context enrichment is best-effort: on error or an unindexed repo, omit the section, do not throw.**
  An unindexed repository is a normal state, not a failure; a throw here takes down the whole review.
- New feature = new module + one line in `src/modules/index.ts`.
