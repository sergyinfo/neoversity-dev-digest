---
name: onion-architecture
description: "Onion / layered architecture review for TypeScript services. Use when reviewing or writing code that spans layers — routes, services, repositories, adapters, domain contracts — or when asked whether a dependency points the right way, where a piece of logic belongs, or whether a layer has leaked. Covers the dependency rule, ports and adapters, what belongs in each ring, this repo's module boundaries, and the runtime invariants that no amount of reading the code will reveal — vendored contract imports, call ordering, and what stdout is reserved for."
---

# Onion Architecture

The rule the whole style rests on: **source-code dependencies point inward only.**
An inner ring may not name anything in an outer ring. Nothing else in this document
matters if that one is broken.

## The rings, outermost to innermost

| Ring | Holds | May depend on |
|---|---|---|
| **Presentation** | HTTP routes, controllers, CLI entrypoints, request/response shapes | everything below |
| **Infrastructure** | repositories, adapter implementations, DB clients, HTTP clients, SDK wrappers | application, domain |
| **Application** | services, use cases, orchestration | domain only |
| **Domain** | entities, value objects, contracts, interfaces | nothing |

Domain is the centre. It must compile with every other ring deleted.

## The dependency rule, concretely

- A service may `import type { GitHubClient }` from the contracts package. It may not
  `import { OctokitGitHubClient }` from an adapter. Depend on the interface; let the
  composition root pick the implementation.
- A repository may import a service's types, never the reverse.
- Nothing below Presentation may import a web framework. A `contract.ts` that imports
  `FastifyRequest` has dragged the framework into the domain.
- Nothing below Infrastructure may import a database client, an ORM, or SQL.
- Imports that point outward are the finding. Imports that point inward are fine even
  when they look surprising.

## Where things belong

**Domain.** Business rules that would still be true if the app were a CLI, a cron job or
a desktop program. Validation of invariants. Types other rings agree on. No I/O.

**Application.** The steps of a use case: fetch this, decide that, persist the result.
Services orchestrate; they do not implement transport or persistence. A service that
builds SQL, or reaches for `fetch`, has absorbed a lower ring's job.

**Infrastructure.** Everything that talks to the world: a repository translating between
domain types and rows, an adapter implementing a domain interface against a vendor SDK.
Infrastructure knows about the domain. The domain does not know it exists.

**Presentation.** Parse the request, call one service, shape the response. Business
decisions here are a leak — a route that branches on domain state is doing the
application layer's work at the edge, where it cannot be reused or tested.

## Ports and adapters

A **port** is an interface owned by an inner ring. An **adapter** is an outer-ring
implementation of it. The point is that the arrow points inward: the adapter depends on
the port, the port knows nothing of the adapter.

Ports belong with the code that needs them, not with the code that satisfies them. An
interface defined next to its only implementation, in the outer ring, is not a port — it
is a class with extra ceremony, and the dependency still points the wrong way.

## Reviewing a change

1. **Locate each file's ring** from its path and what it exports.
2. **Read the imports first.** They are where the violations are, and they are cheap to
   check. For each one, ask which ring it comes from and whether that is inward.
3. **Then read the body** for smuggled dependencies: raw SQL in a service, a `fetch` in a
   domain entity, a framework type in a signature.
4. **Judge the direction, not the aesthetics.** A long service is not a violation. A
   two-line import that points outward is.
5. **Report the arrow.** A finding is only actionable if it names the importer, the
   imported, and which way the dependency runs. "Service imports adapter class
   `OctokitGitHubClient` (application -> infrastructure)" is a finding; "poor separation
   of concerns" is not.

## Module boundaries (DevDigest)

Rings answer *which way* a dependency may point. They say nothing about *how far
sideways* it may reach. In this codebase a second boundary runs at right angles to the
rings: each feature module under `server/src/modules/<name>/` is a vertical slice —
`routes.ts`, `service.ts`, `repository.ts`, `contract.ts` — and slices are as isolated
from each other as rings are from the ones outside them.

Three rules, none of which follows from Onion itself:

**1. A module never imports another module's internals.** `import { BriefService } from
'../brief/service.js'` is a violation even though both files sit in the same ring and the
arrow does not point outward. Cross-module work goes through the composition root:
depend on `container.brief`, injected, typed by an interface. A direct import couples two
slices that are meant to be deletable independently, and it is invisible to a
ring-only review because nothing about it points the wrong way.

The sanctioned exceptions are `modules/_shared/` and `src/platform/`. Both exist to be
imported by many modules; using them is correct and should not be reported.

**2. repo-intel is reached only through `container.repoIntel.*`.** The facade is the
supported surface. Importing anything under `modules/repo-intel/` other than through the
container — the pipeline, the indexer, an internal type — bypasses it. The facade exists
because the pipeline's shape is not stable; callers that reach past it break silently on
changes the facade was written to absorb.

**3. Registration is one static line in `src/modules/index.ts`.** A module is added by
creating `modules/<name>/routes.ts` and adding one import plus one entry to the registry.
Filesystem autoload, dynamic `import()` of a module path, or registering a route plugin
from anywhere else is a violation — not stylistic, but because native dynamic import of
`.ts` files does not behave the same under tsx, the bundler and vitest, so an autoloaded
module works in one runner and vanishes in another.

**Reviewing for this.** After the ring pass, run a second pass over the same imports and
ask a different question: does this path leave the module's own directory? If it does and
the target is not `_shared/`, `platform/`, `db/`, `adapters/` or a package, that is the
finding — regardless of which ring either end sits in.

## Invariants you cannot infer from the code

Everything above can be re-derived by a careful reader: a dependency pointing outward
looks wrong, a module reaching into a sibling looks coupled. The rules below cannot. In
each one the violating line is indistinguishable from correct code, the reason lives
outside the file, and the failure is silent — no exception, no failing test, just a wrong
answer delivered confidently. Check them explicitly; nothing in the code will prompt you.

**Vendored contracts are type-only.** `server/src/vendor/shared/` is a pinned copy of the
contracts on zod 3, and packages that are themselves on zod 4 reach it through a tsconfig
path alias. From those packages, import from it with `import type` and nothing else.

```ts
import type { PullContract } from '@devdigest/shared';   // correct
import { pullSchema } from '@devdigest/shared';          // a runtime zod-3 object in a zod-4 process
```

The second line compiles, resolves, and ships. At runtime you hold a schema built by a
different zod major: `instanceof` checks against your own `z.ZodType` fail, refinements
attached by the host version silently do not run, and error shapes differ enough that a
`safeParse` branch takes the wrong path. Nothing crashes. The word `type` is the entire
difference, so read the import keyword, not the module path.

**`run_review` must warm the diff before it reviews.** `GET /pulls/:id` populates the
diff cache that `POST /pulls/:id/review` reads. Call the POST alone and the review runs
against an empty diff and returns a confident "approve / 100" — a false pass, which is
worse than an error because nothing downstream can tell it from a real one. Two calls in
the wrong order look like two ordinary calls; verify the GET is there and that it
precedes the POST on every path, including early returns and retries.

**In the MCP package, stdout is the protocol wire.** JSON-RPC frames travel on stdout, so
a single `console.log` interleaves text into the frame stream and the client either drops
the connection or mis-parses the next message. Diagnostics go to stderr — `console.error`,
or a logger that writes to `process.stderr`. A `console.log` looks like ordinary debugging
and is the most innocuous-looking serious bug in that package.

**The MCP package must never import `reviewer-core`.** `devdigest review` goes through
`POST /reviews/diff` so it reuses the server's `run-executor`. Importing the review engine
directly and calling it in-process reads as an improvement — one less network hop, one
less moving part, no duplicated orchestration — and it is the one change in that package
that is categorically forbidden. The HTTP path is not overhead; it is where the grounding
gate, agent selection, run tracing and persistence live. An in-process review skips all
four and becomes a second implementation that drifts from production without ever
disagreeing loudly. Any `import ... from '@devdigest/reviewer-core'` under `mcp/` is the
finding, however reasonable the surrounding code looks.

**Reviewing for these.** They do not announce themselves, so make three explicit passes
rather than waiting to notice something: grep the imports for value imports of vendored
contracts; find every review POST and check what precedes it; grep for `console.log` in
anything that speaks the protocol; grep `mcp/` for any import of `reviewer-core`. Report the invariant and why it is silent — a reader
who does not know the reason will "fix" it back.

## What is not a violation

Say so explicitly when you check these and they are fine — a review that only lists
problems leaves the reader unsure what was examined.

- An outer ring importing an inner one. That is the rule working.
- A composition root (container, factory, `main`) importing concrete classes from every
  ring. Wiring is its whole job; it is the one place allowed to know everything.
- Shared kernel types used by several rings, as long as they carry no I/O.
- `import type` of a framework type in Presentation.
- Duplication between a domain type and a DB row type. They change for different
  reasons, and collapsing them couples the rings.
- A module importing `modules/_shared/` or `src/platform/`. Those are shared on purpose.
- The container importing concrete services from every module. It is the composition
  root; see above.
- `import type` of a vendored contract, and `console.error` for diagnostics. Those are
  the correct halves of the two invariants above; say so when you check them.
