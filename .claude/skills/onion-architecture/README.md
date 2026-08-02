# onion-architecture — sources

**Version 1.0.0** · researched and built 2026-08-02 · scope `server/`.

## Why this skill exists

The backend was already ~80 % onion with no name for it: 28 port interfaces in
`vendor/shared/adapters.ts`, adapters isolated in `adapters/`, a composition root in
`platform/container.ts`, and `AGENTS.md` stating the intent — *"services depend on
interfaces, not classes"*. What was missing was enforcement, so the intent had drifted in
four modules.

The skill names the rings, gives a placement rule, and ships
`server/.dependency-cruiser.cjs` so the boundaries are machine-checked rather than
aspirational.

## Canonical

| Source | What it contributes |
|---|---|
| [Jeffrey Palermo — The Onion Architecture, part 1 (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) | The origin and the one rule: *"all code can depend on layers more central, but code cannot depend on layers further out from the core."* On persistence: *"The object saving behavior is not in the application core… Only the interface is in the application core."* And *"The database is not the center. It is external."* |
| [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) | The best analysis. Positions Onion against Ports & Adapters and DDD; notes any outer layer may call any inner layer **directly**, so no pass-through proxies are needed — the basis for the thin-module exemption. Dissents from Palermo on repository-interface placement |
| [Onion vs Clean vs Hexagonal](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91) · [CCD Akademie comparison](https://ccd-akademie.de/en/clean-architecture-vs-onion-architecture-vs-hexagonal-architecture/) | All three are the same idea in different vocabulary. Reason for picking one set of words — rings, ports, adapters, composition root — and using it consistently |
| [NDepend — Onion Architecture: going beyond layers](https://blog.ndepend.com/onion-architecture-layers/) | Why the dependency *direction*, not the layer count, is the point |
| [Allegro Tech — Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html) | A production write-up rather than a tutorial |

## Node / TypeScript

| Source | What it contributes |
|---|---|
| [Implementing SOLID and the onion architecture in Node.js with TypeScript](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) | The reference Node treatment. Deliberately **not** followed on DI: it is InversifyJS-heavy, and this repo's hand-rolled container already gives lazy resolution, caching and test overrides without a framework |
| [Melzar — onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate) | A full folder layout to compare against |
| [Khalil Stemmler — DTOs, Mappers & the Repository Pattern](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/) | The mapper step that keeps ORM rows out of the domain |

## Tool-specific

| Source | What it contributes |
|---|---|
| [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) · [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) · [Plugins guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) | Plugin scope is the DI boundary; decorators propagate to descendants only, never to ancestors — composition-root behaviour enforced by the framework |
| [Sentry — Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) | Repository granularity and transactions |
| [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) · [Drizzle ORM best practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) | Keeping Drizzle types behind the repository; naming methods in domain terms (`authenticateUser`, not `findByEmailAndPassword`) |
| [Zod at the boundary](https://joshkaramuth.com/blog/tanstack-zod-dto/) | *"Zod catches shape and constraints, but domain rules still belong in the service layer."* |

## Enforcement

| Source | What it contributes |
|---|---|
| [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | `forbidden`/`allowed` semantics, regex path matching, `pathNot`, backreferences across `from`/`to`, severities |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | `depcruise --init` for a starting config |
| [Validate dependencies according to Clean Architecture](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c) | A worked layered rule set |
| [Avoid cross-module dependencies with dependency-cruiser](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b) | The cross-module rule, which maps onto `modules/*` here |
| [Restrict imports in JavaScript](https://spin.atomicobject.com/dependency-cruiser-imports/) | Practical config walkthrough |

## Decisions

Four were approved before building; the fifth emerged while testing the config.

**1. Repository interfaces stay in `vendor/shared/adapters.ts`.** Palermo puts them in the
domain-services ring; Graça argues the domain knows nothing about persistence, so they are
application-layer ports. This repo already has all 28 ports in one vendored file marked
do-not-touch. The skill documents the existing placement rather than relitigating it — and
Graça's reading is the one that matches it.

**2. Thin modules may go `routes → repository`.** When a service would contain zero logic,
an empty pass-through adds a file and no information. Graça's point that any outer layer may
call any inner layer directly supports this. SQL still never appears in `routes.ts`.

**3. The skill ships the config, not just advice.** `server/.dependency-cruiser.cjs` plus
`pnpm lint:arch`. An unenforced architecture skill is a style guide.

**4. Scope is `server/` only.** `reviewer-core/` is cited as the reference clean core — its
domain logic is pure and its only infrastructure is isolated in `src/llm/` — but it is a
separate package with its own dependencies and is not governed by these rules.

**5. Severities encode migration state, not permission.** Rules with outstanding violations
start at `warn`; only clean rules are `error`. A rule set that fails the build on day one
gets disabled by the first person in a hurry. Adding a *new* violation of a warn-level rule
is still a review failure.

## What the config found

Running it was not a formality — it changed the config twice:

- **The first version was too broad.** `adapters/ → platform/` produced 7 violations that were all legitimate (adapters need `platform/errors`, `resilience`, `structured` — cross-cutting utilities, not the composition root). Narrowed to `platform/(container|jobs).ts`. *A rule with many reasonable-looking violations is a wrong rule, not a dirty codebase.*
- **It found more than predicted.** Cycles between repo-intel and the container, and between `agents/helpers.ts` and `agents/repository.ts`, were not in the plan.

Also worth recording: an early manual count of "SQL in routes" using a line-based grep
reported 7 queries. The real number is 24 — Drizzle chains break across lines. The lint rule
matches the *import*, which is immune to formatting.

## Weakest area

The **thin-module exemption** is the rule most likely to be abused. It is justified by
Graça and by not wanting empty pass-through files, but "the service would have no logic" is
a judgement call, and the easy failure is a module that quietly accumulates orchestration
in its routes. If drift shows up there, remove the exemption rather than widen it.

## Changelog

**1.0.0** — 2026-08-02. Initial version. 18 sources, five decisions, a working
`dependency-cruiser` config with a 16-warning baseline.
