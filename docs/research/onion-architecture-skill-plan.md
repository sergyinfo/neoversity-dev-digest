# Plan — `onion-architecture` skill (backend)

Draft plan, 2026-08-02. Not yet built. Open decisions at the end need answers first.

---

## 1. Goal

A skill that **enforces** Onion Architecture in `server/`, expressed in the tools this
backend actually uses — not a generic essay about layers.

Enforcing means three things, in descending order of value:

1. A **machine-checkable** boundary rule set (`dependency-cruiser`, already a dependency).
2. A **placement rule** an agent applies before creating any backend file.
3. A **review checklist** for diffs.

## 2. What the backend actually is

**Stack:** Fastify 5 (+ autoload, cors, helmet, rate-limit, sse-v2, type-provider-zod) ·
Drizzle ORM over postgres-js · Zod · Octokit · simple-git · OpenAI / Anthropic SDKs ·
p-queue · ripgrep + ast-grep + graphology (indexer) · Vitest + testcontainers ·
**dependency-cruiser (present, used as an indexer runtime dep — no architecture config).**

**The good news: this codebase is already ~80 % onion.** It has all the pieces and no name
for them:

| Ring (inside → out) | Where it lives today |
|---|---|
| Domain contracts | `vendor/shared/contracts/*` (Zod schemas + inferred types) |
| **Ports** | `vendor/shared/adapters.ts` — **28 interfaces** (`GitHubClient`, `GitClient`, `LLMProvider`, `SecretsProvider`, `CodeIndex`, …) |
| Pure domain logic | `reviewer-core/src/` — grounding, prompt, reduce, to-review |
| Application services | `modules/*/service.ts`, `platform/*` (jobs, model-router, resilience) |
| Persistence | `modules/*/repository.ts` (+ `repository/*.repo.ts`), `db/` |
| Adapters | `adapters/*` — octokit, simple-git, openai, anthropic, local secrets, ripgrep, ast-grep |
| Delivery | `modules/*/routes.ts`, `app.ts`, `server.ts` |
| Composition root | `platform/container.ts` |

`AGENTS.md` already states the intent — *"services depend on interfaces
(`@devdigest/shared`), not classes"*, *"repo-intel is reached ONLY through the facade
`container.repoIntel.*`"*. The skill's job is to make that enforceable rather than
aspirational.

## 3. Measured drift (the enforcement targets)

Not hypothetical — counted in the current tree.

### A. Four modules do SQL in the HTTP layer

| Module | imports `db/schema` | direct `container.db.*` queries in `routes.ts` | `service.ts` | `repository.ts` |
|---|---|---|---|---|
| `pulls` | yes | **17** | — | — |
| `polling` | yes | 3 | — | — |
| `settings` | yes | 3 | — | — |
| `workspace` | yes | 1 | — | — |

**24 queries total.** The correlation is exact: the four modules that skip service and
repository are the four that write SQL in routes. The other five (`agents`, `repos`,
`reviews`, `repo-intel`) have the full stack and **zero** queries in routes.

> Measurement note: a line-based grep undercounts these badly — Drizzle chains break across
> lines (`container.db\n  .select()`). A first pass reported 7; the multi-line-aware count is
> 24. Any lint rule the skill ships must match on the import, not the call site.

### B. A row type leaks upward

`modules/reviews/service.ts:4` imports `AgentRow` from `db/rows.js`. Type-only, so no
runtime coupling — but it means the application layer is typed in terms of database rows.
Milder than A; worth a `warn`, not an `error`.

### C. Two "adapter" imports that are probably misfiled

`reviews/diff-loader.ts` imports `parseUnifiedDiff`, `repo-intel/service.ts` imports
`extractEndpoints` and the ast-grep helpers — all from `adapters/`. These are **pure
functions**, not I/O clients. The honest reading is that `adapters/` currently holds two
kinds of thing, and the fix is to move the pure helpers out, not to forbid the import.
The skill should say so rather than flagging a false positive.

## 4. Proposed skill

**Name:** `onion-architecture`
**Version:** `1.0.0` in `metadata` (there is no official frontmatter `version` field).

```
.claude/skills/onion-architecture/
├── SKILL.md                    ~180 lines: the rings, the one rule, placement table,
│                               review checklist, pointers
├── README.md                   sources, decisions, weak spots
└── reference/
    ├── layers.md               ring-by-ring: what belongs, what must never appear
    ├── enforcement.md          dependency-cruiser config + npm script + CI wiring
    ├── tools.md                Fastify / Drizzle / Zod / container — per-tool rules
    └── migration.md            how to fix the drift in §3 without a big-bang rewrite
```

Same shape as `frontend-ui-architecture` (SKILL.md under 500 lines, detail behind
reference files), and complementary to `fastify-best-practices` and
`drizzle-orm-patterns`, which cover **how to use the tool**, not **where the code goes**.

### SKILL.md content sketch

**The one rule.** *Dependencies point inward. An inner ring never imports an outer one.*
Everything else follows.

**Placement table** — the fast path for "where does this go":

| What you are writing | Ring | File |
|---|---|---|
| HTTP route, schema binding, status codes | Delivery | `modules/<m>/routes.ts` |
| Orchestration, transactions, business rules | Application | `modules/<m>/service.ts` |
| Any SQL | Persistence | `modules/<m>/repository.ts` |
| Talking to GitHub / git / an LLM / the filesystem | Adapter | `adapters/<kind>/` |
| The interface that adapter implements | Port | `vendor/shared/adapters.ts` |
| Wiring a concrete adapter to a port | Composition root | `platform/container.ts` |
| A rule that is true regardless of transport or storage | Domain | contracts / `reviewer-core` |

**Hard prohibitions** (each maps to a lint rule):

- `routes.ts` must not import `db/` — no SQL in the HTTP layer.
- `service.ts` must not import `adapters/*` concretes — depend on the port, get it from the container.
- `db/` and `adapters/` must not import `modules/`.
- Nothing outside `platform/container.ts` constructs an adapter class.
- `reviewer-core` must not import server code.
- No cross-module imports between `modules/*` — compose at the route or the container.

### reference/tools.md — the part that makes it ours

- **Fastify** — routes are an adapter, not a layer. Plugin encapsulation is the DI scope; the container is decorated once and read from `app.container`. A route handler should read as: parse → call service → map to response. Zod lives here (via `fastify-type-provider-zod`), at the boundary.
- **Drizzle** — never leaks past `repository.ts`. Repository methods are named in domain terms (`findOpenPullsForRepo`), not query terms (`selectWhere`). They return contract types, not `$inferSelect` rows. Translate DB errors into domain errors at that boundary (`platform/errors.ts` already exists for this).
- **Zod** — boundary validation, not domain invariants. Shape and constraints at the edge; business rules stay in the service. Contracts in `vendor/shared` are the shared vocabulary of the ring, so they are the one thing every layer may import.
- **Container** — the only place that says `new OctokitGitHubClient(...)`. Tests swap ports via `ContainerOverrides`; that is the payoff for the whole discipline and worth stating explicitly.

### reference/enforcement.md — the actual value

`dependency-cruiser` is already installed. Ship a config and a script:

```js
// server/.dependency-cruiser.cjs
forbidden: [
  { name: 'no-sql-in-routes', severity: 'error',
    from: { path: 'modules/[^/]+/routes\\.ts$' },
    to:   { path: '^src/db/' } },
  { name: 'no-concrete-adapters-in-services', severity: 'error',
    from: { path: 'modules/[^/]+/service\\.ts$' },
    to:   { path: '^src/adapters/' } },
  { name: 'no-inward-to-outward', severity: 'error',
    from: { path: '^src/(db|adapters)/' },
    to:   { path: '^src/modules/' } },
  { name: 'no-cross-module', severity: 'error',
    from: { path: '^src/modules/([^/]+)/' },
    to:   { path: '^src/modules/(?!\\1|_shared)[^/]+/' } },
  { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
]
```

Plus `"lint:arch": "depcruise src --config .dependency-cruiser.cjs"` and a CI step.

Introduce violations as `warn` first so the build stays green, then promote to `error`
per rule as §3 gets cleaned up. A rule that fails on day one gets disabled by whoever is
in a hurry.

### reference/migration.md

Ordered, each step independently shippable:

1. `workspace` (1 query) — smallest, proves the shape.
2. `settings` (3) and `polling` (3).
3. `pulls` (17) — the real work; split its read aggregates into `repository/`.
4. Retype `reviews/service.ts` off `AgentRow`.
5. Move the pure helpers out of `adapters/` into `platform/` or the owning module.
6. Flip each lint rule from `warn` to `error` as its class of violation reaches zero.

## 5. Open decisions

Need answers before building.

**1. Where do repository interfaces belong?** Palermo puts them in the domain-services
ring; Herberto Graça argues the domain knows nothing about persistence, so they are
application-layer ports. This repo already puts all 28 ports in
`vendor/shared/adapters.ts`, which `AGENTS.md` marks do-not-touch. Proposal: **document
the existing placement, do not relitigate it.**

**2. How strict for thin modules?** `settings` and `workspace` are near-CRUD. Does the
skill demand a full `routes → service → repository` chain, or allow a documented
`routes → repository` exemption when there is no orchestration? Full strictness is
consistent; the exemption avoids empty pass-through services. Proposal: **allow
`routes → repository` when the service would contain zero logic, and forbid SQL in routes
either way.**

**3. Does the skill ship the config, or only describe it?** Shipping
`.dependency-cruiser.cjs` + the npm script means editing `server/`, not just adding a
skill. Proposal: **ship it** — an unenforced architecture skill is a style guide.

**4. Scope.** `server/` only, or `reviewer-core/` too? It is the purest domain code in the
repo and a good example, but it has its own package and its own `openai` dependency inside
`llm/openrouter.ts`. Proposal: **server-only rules; cite reviewer-core as the reference
example of a clean core.**

## 6. Sources

### Canonical

- [Jeffrey Palermo — The Onion Architecture, part 1 (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — the origin. *"All code can depend on layers more central, but code cannot depend on layers further out from the core."* And on persistence: *"The object saving behavior is not in the application core… Only the interface is in the application core."* Plus *"The database is not the center. It is external."*
- [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) — the best analysis; positions Onion against Ports & Adapters and DDD, and dissents from Palermo on repository-interface placement. Also notes any outer layer may call any inner layer directly, so no pass-through proxies are needed.
- [Alistair Cockburn's Ports & Adapters, via the comparison literature](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91) · [CCD Akademie comparison](https://ccd-akademie.de/en/clean-architecture-vs-onion-architecture-vs-hexagonal-architecture/) — Onion / Hexagonal / Clean are the same idea with different vocabulary; useful so the skill picks one set of words and sticks to it.
- [NDepend — Onion Architecture: going beyond layers](https://blog.ndepend.com/onion-architecture-layers/) — why the dependency direction, not the layer count, is the point.
- [Allegro Tech — Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html) — a production write-up rather than a tutorial.

### Node / TypeScript

- [Implementing SOLID and the onion architecture in Node.js with TypeScript](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) — the reference Node treatment; DI-container-heavy, which is worth knowing to deliberately not copy (this repo has a hand-rolled container and does not need InversifyJS).
- [Melzar — onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate) — a full folder layout to compare against.
- [Khalil Stemmler — DTOs, Mappers & the Repository Pattern](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/) — the mapper step that keeps ORM rows out of the domain.

### Tool-specific

- [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) · [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) · [Plugins guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) — the plugin scope is the DI boundary; decorators propagate to descendants only, which is exactly the composition-root behaviour onion wants.
- [Sentry — Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) — repository granularity and transactions.
- [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) · [Drizzle ORM best practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) — keeping Drizzle types behind the repository; naming methods in domain terms.
- [Zod at the boundary](https://joshkaramuth.com/blog/tanstack-zod-dto/) — validation belongs at the edge; *"Zod catches shape and constraints, but domain rules still belong in the service layer."*

### Enforcement

- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — `forbidden` / `allowed` semantics, regex path matching, `pathNot`, severities.
- [dependency-cruiser repo](https://github.com/sverweij/dependency-cruiser) — `depcruise --init` generates a starting config.
- [Validate dependencies according to Clean Architecture](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c) — a worked layered rule set.
- [Avoid cross-module dependencies with dependency-cruiser](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b) — the cross-module rule, which maps onto `modules/*` here.
- [Restrict imports in JavaScript](https://spin.atomicobject.com/dependency-cruiser-imports/) — practical config walkthrough.
