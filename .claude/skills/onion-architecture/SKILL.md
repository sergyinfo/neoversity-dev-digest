---
name: onion-architecture
description: "Enforces Onion Architecture in the DevDigest backend (server/). Decides which ring a piece of backend code belongs to and forbids the imports that break the dependency direction — SQL in HTTP handlers, concrete adapters in services, cross-module imports, cycles. Use when adding a backend route, service, repository, adapter or port; when wiring something into the container; when a module needs data from another module; or when reviewing a server-side diff for layering. Answers 'which file should this go in', 'may X import Y', 'where do I put this query'. Trigger terms: onion architecture, layering, dependency direction, ports and adapters, repository, composition root, container, dependency-cruiser, lint:arch, SQL in routes, cross-module import."
when_to_use: "Backend structural decisions in server/. Not a Fastify or Drizzle usage guide — for API surface see fastify-best-practices, for query syntax see drizzle-orm-patterns."
metadata:
  version: 1.0.0
  tags: backend, architecture, onion, layering, fastify, drizzle, dependency-cruiser
---

# Onion Architecture — backend

Scope: **`server/`**. `reviewer-core/` is cited as the reference clean core but is not
governed by these rules.

## The one rule

> **Dependencies point inward. An inner ring never imports an outer one.**

Everything below is a consequence. When unsure, ask: *does this import make an inner thing
know about an outer thing?* If yes, it is wrong regardless of how convenient it is.

## The rings

```
        delivery        modules/*/routes.ts · app.ts · server.ts
        application     modules/*/service.ts · platform/*
        persistence     modules/*/repository.ts · db/
        ports           vendor/shared/adapters.ts        ← 28 interfaces
        domain          vendor/shared/contracts/* · reviewer-core

        adapters/*      implement ports · outermost, wired in, never imported inward
        platform/container.ts    composition root — the ONLY place that constructs adapters
```

`vendor/shared/` is the shared vocabulary of every ring and may be imported from anywhere.
It is also **do-not-touch** without coordination (see root `AGENTS.md`).

## Where does this go?

| What you are writing | File |
|---|---|
| HTTP route, schema binding, status codes | `modules/<m>/routes.ts` |
| Orchestration, transactions, business rules | `modules/<m>/service.ts` |
| Any SQL | `modules/<m>/repository.ts` |
| Talking to GitHub / git / an LLM / the filesystem | `adapters/<kind>/` |
| The interface that adapter implements | `vendor/shared/adapters.ts` (port) |
| Wiring a concrete adapter to a port | `platform/container.ts` |
| A rule true regardless of transport or storage | contracts / `reviewer-core` |
| A cross-cutting helper (retry, errors, tokenizing) | `platform/` |

**Thin-module exemption:** when a service would contain zero logic — a pure CRUD read —
`routes → repository` is allowed. An empty pass-through service is noise. The SQL still
does not belong in `routes.ts`.

## Prohibitions

Each maps to a rule in `server/.dependency-cruiser.cjs`:

| Rule | Meaning |
|---|---|
| `no-sql-in-routes` | `routes.ts` must not import `db/`. Handlers parse, delegate, respond. |
| `no-concrete-adapters-in-app-layer` | `service.ts` / `repository.ts` depend on **ports**, and get implementations from the container. |
| `no-inward-to-outward` | `db/` and `adapters/` must never import `modules/`. |
| `no-composition-root-in-adapters` | Adapters are wired *by* the container; they must not reach back into it or into `jobs`. |
| `no-cross-module-imports` | Modules are independent. Compose at the route or the container; shared code goes to `modules/_shared/` or `platform/`. |
| `no-circular` | A cycle means the layering is wrong somewhere in the loop. |

Run: `pnpm lint:arch` (from `server/`).

## Baseline — do not add to these

The rule set was introduced against a real codebase, so six rules start at `warn` with a
known set of outstanding violations. **Adding a new violation of a warn-level rule is still
a review failure** — the severity reflects migration state, not permission.

Current baseline: **16 warnings, 0 errors.**

| Rule | Outstanding |
|---|---|
| `no-circular` | 5 — repo-intel ↔ container, agents helpers ↔ repository |
| `no-sql-in-routes` | 4 — `pulls`, `polling`, `settings`, `workspace` |
| `no-orphans` | 2 — `trace-builder.ts`, `model-router.ts` |
| `no-inward-to-outward` | 2 — astgrep, depgraph read repo-intel constants |
| `no-concrete-adapters-in-app-layer` | 2 — repo-intel service imports pure helpers filed under `adapters/` |
| `no-cross-module-imports` | 1 — `repos/service.ts` → repo-intel constants |

If a change lowers a count to zero, promote that rule to `error` in the same PR. See
[reference/migration.md](reference/migration.md).

## Tool rules

- **Fastify** — routes are an adapter, not a layer. Plugin encapsulation is the DI scope; the container is decorated once and read as `app.container`. A handler should read: parse → call service → map to response.
- **Drizzle** — never leaks past `repository.ts`. Method names are domain terms (`findOpenPullsForRepo`), not query terms (`selectWhere`). Return contract types, not `$inferSelect` rows. Translate DB errors into `platform/errors.ts` types at that boundary.
- **Zod** — boundary validation, not domain invariants. Shape and constraints at the edge (via `fastify-type-provider-zod`); business rules stay in the service.
- **Container** — the only place that says `new OctokitGitHubClient(...)`. Tests swap ports via `ContainerOverrides`; that substitutability is the payoff for the whole discipline.

Detail: [reference/tools.md](reference/tools.md).

## Review checklist

- [ ] Does `routes.ts` import anything from `db/`?
- [ ] Does a service import a concrete adapter instead of a port?
- [ ] Is an adapter constructed anywhere but `platform/container.ts`?
- [ ] Does a repository return a Drizzle row type past its own boundary?
- [ ] Does one module import another?
- [ ] Does `pnpm lint:arch` report more violations than the baseline above?

## Reference

- [reference/layers.md](reference/layers.md) — ring by ring: what belongs, what must never appear, worked examples.
- [reference/tools.md](reference/tools.md) — Fastify, Drizzle, Zod, container in detail.
- [reference/enforcement.md](reference/enforcement.md) — the config, how the rules are written, CI wiring.
- [reference/migration.md](reference/migration.md) — ordered plan for clearing the baseline.
- [README.md](README.md) — sources and the decisions taken where they disagree.
