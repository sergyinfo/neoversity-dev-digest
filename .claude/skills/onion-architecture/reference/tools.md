# Tools, in onion terms

How each tool in this backend maps onto the rings. For API surface see
`fastify-best-practices`; for query syntax see `drizzle-orm-patterns`. This file is only
about **where the code goes**.

## Fastify — delivery

Routes are an **adapter**, not a layer of their own. HTTP is one way in; a CLI or a job
runner would be another, and neither should change a service.

Plugin encapsulation is the DI scope. `register` creates a child context whose decorators
propagate to descendants but never to ancestors — which is exactly composition-root
behaviour, enforced by the framework. The container is decorated once and read as
`app.container`.

A handler is three steps: parse → delegate → serialize.

```ts
// ✓
app.post('/pulls/:id/review', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const body = RunRequest.parse(req.body ?? {});
  return service.runReview(workspaceId, req.params.id, body);
});

// ✗ orchestration in the handler
app.post('/pulls/:id/review', async (req) => {
  const rows = await container.db.select().from(t.agents)…   // SQL in delivery
  for (const a of rows) { /* fan-out, retries, cost accounting */ }
});
```

Modules are registered statically in `src/modules/index.ts` — no filesystem autoload. A new
feature is a new module plus one line there.

Route-level concerns that legitimately live in `routes.ts`: schema binding, status codes,
rate-limit config, SSE setup, auth context extraction.

## Drizzle — persistence only

Drizzle types must not appear in any signature outside `repository.ts`.

```ts
// ✓ repository speaks domain
async findOpenPullsForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]>

// ✗ ORM escapes
async getRows(): Promise<typeof t.pullRequests.$inferSelect[]>
```

Name methods for what the caller wants, not for the query shape: `activateAgent`, not
`updateColumns`. If a service reads like SQL, the repository is too thin.

Translate database errors into `platform/errors.ts` types at this boundary. A service
should never catch a postgres error code.

Every query is scoped by `workspaceId`. The tenancy guard belongs here, so no caller can
forget it.

**Known leak:** `modules/reviews/service.ts` imports `AgentRow` from `db/rows.js`. Type-only,
so no runtime coupling, but the application layer is typed in database terms. Fix by adding
a contract type.

Schema changes: edit `db/schema/*.ts`, then `pnpm db:generate` (drizzle-kit) — never
hand-write migration SQL. `db/migrations/` is do-not-touch.

## Zod — the boundary

Zod validates **shape and constraints at the edge**. Business invariants are the service's
job.

```ts
// ✓ boundary: is this well-formed?
const RunRequest = z.object({ agentId: z.string().uuid().optional(), all: z.boolean().optional() });

// ✗ business rule smuggled into a schema
const RunRequest = z.object({ agentId: z.string() })
  .refine(async id => (await db.agents.find(id))?.enabled, 'agent disabled');
```

Contracts in `vendor/shared/contracts/*` are the shared vocabulary of every ring, which is
why they are the one thing all layers may import. They are inferred into types
(`z.infer`), so the schema is the single source of truth for both validation and typing.

Wired through `fastify-type-provider-zod`, so a route's `schema` block gives both runtime
validation and handler typing.

## The container — composition root

The only place that constructs adapters.

```ts
async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
  const injected = this.overrides.llm?.[id];
  if (injected) return injected;                    // tests
  return this.llmCache.get(id) ?? this.buildLlm(id);
}
```

Three properties worth preserving:

- **Lazy.** A missing `ANTHROPIC_API_KEY` only fails when an Anthropic review runs, not at boot.
- **Cached.** One client per process; `invalidateSecretCaches()` resets when a key changes.
- **Overridable.** `ContainerOverrides` is how tests inject `MockGitHubClient` without touching a service. This is the return on the whole discipline — if you find yourself unable to test something without network, a port is missing.

## Testing follows the rings

- **Domain / pure functions** — plain unit tests, no container.
- **Services** — real service, mock ports via `ContainerOverrides`. No database.
- **Repositories** — testcontainers Postgres. These are the `*.it.test.ts` files.
- **Routes** — `routes-smoke.test.ts`, asserting wiring rather than behaviour.

Filename split is load-bearing: `*.it.test.ts` are DB-backed, everything else is hermetic
(`pnpm exec vitest run --exclude '**/*.it.test.ts'`).

If a test needs a database to check a business rule, the rule is in the wrong ring.
