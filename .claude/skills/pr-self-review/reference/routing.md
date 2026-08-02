# Routing: changed path → skills

Most specific match wins. A file may collect several skills; cap the run at 4 unless the
diff genuinely spans more.

## Server

| Path | Skills |
|---|---|
| `server/src/modules/**/routes.ts` | `onion-architecture`, `fastify-best-practices` |
| `server/src/modules/**/service.ts` | `onion-architecture` |
| `server/src/modules/**/repository*.ts`, `repository/**` | `onion-architecture`, `drizzle-orm-patterns` |
| `server/src/adapters/**` | `onion-architecture` |
| `server/src/platform/**` | `onion-architecture` |
| `server/src/db/schema/**` | `postgresql-table-design`, `drizzle-orm-patterns` |
| `server/src/db/migrations/**` | `drizzle-orm-patterns` + **do-not-touch flag** |
| `server/src/vendor/shared/contracts/**` | `zod`, `onion-architecture` + **lock-step flag** |
| `server/src/vendor/shared/**` (other) | `onion-architecture` + **do-not-touch flag** |
| `server/src/app.ts`, `server.ts` | `fastify-best-practices`, `onion-architecture` |
| `server/test/**` | — (assertions, not architecture) |

## Client

| Path | Skills |
|---|---|
| `client/src/app/**/*.tsx` | `next-best-practices`, `frontend-ui-architecture`, `react-best-practices` |
| `client/src/app/**/layout.tsx`, `page.tsx`, `route.ts` | `next-best-practices` (RSC rules apply hardest here) |
| `client/src/**/*.test.tsx` | `react-testing-library` |
| `client/src/components/**`, `client/src/lib/**` | `frontend-ui-architecture`, `react-best-practices` |
| `client/src/vendor/**` | `frontend-ui-architecture` + **vendored-UI flag** |
| `client/src/**/*.tsx` (anything else) | `react-best-practices`, `frontend-ui-architecture` |

## Other packages

| Path | Skills |
|---|---|
| `reviewer-core/**` | `typescript-expert`. **Not governed by `onion-architecture`** — separate package, cited as the clean-core reference |
| `e2e/specs/**` | — flow JSON; the seed-coupling trap covers it |
| `e2e/**/*.ts` | `typescript-expert` |

## Cross-cutting

Applied **in addition** to the above when the trigger matches anywhere in the diff:

| Trigger | Skill |
|---|---|
| Any `.ts` / `.tsx` | `typescript-expert` |
| Touches auth, session, token, secret, `process.env`, `sql.raw`, user input reaching a query, file path from a request | `security` |
| Defines or edits a Zod schema | `zod` |

## Not review skills

Never route to these: `engineering-insights`, `mermaid-diagram`, `pr-self-review` itself.

## Unmapped paths

Any changed file under `server/src`, `client/src`, `reviewer-core/src` or `e2e/` that
matches no row above is **reported as a finding** ("reviewed by nothing"), and the routing
table should be extended in the same PR.

Non-source paths — `docs/`, `*.md`, `.github/`, lockfiles, `.claude/skills/**` — are
correctly unmapped and reported as skipped, not as findings.

## Keeping this current

When a skill is added or renamed, add it here. A skill absent from this table never runs in
the gate, which is a silent failure — it looks like a clean review.
