---
name: frontend-ui-architecture
description: "Decides WHERE frontend code goes and HOW it is split — folder structure, component boundaries, and the placement of constants, utils, helpers, business logic and state in React and Next.js apps. Use when creating a new component/feature/route, when a file or component has grown too large, when deciding between a local and a shared location, when a util or hook needs promoting, when adding a Server Action or data access, or when reviewing a diff for structural drift. Answers questions of the form 'where should this live', 'should I split this', 'is this the right folder'. Trigger terms: folder structure, project structure, file organization, where to put, colocation, feature folder, barrel file, business logic, custom hook vs util, component too large, use client boundary, server action placement."
when_to_use: "Structural decisions, not runtime behaviour. Reach for it before writing a new file, while splitting an existing one, or when reviewing organization. It is deliberately silent on performance, styling and testing technique."
metadata:
  version: 1.0.0
  tags: react, nextjs, architecture, project-structure, code-organization, rsc
---

# Frontend UI architecture

Rules for **where code lives and how it is split**. Not a performance or API guide —
for those see `react-best-practices` (rules and anti-patterns) and `next-best-practices`
(framework mechanics).

## Prime directive

**Match the project you are in.** Read the existing structure before proposing one.
A consistent structure you dislike beats a better structure applied to half the codebase.
Only propose restructuring when asked, or when a rule below is being actively violated by
the change under review.

When the existing convention is unclear, apply the defaults here.

## The one principle

> Place code as close to where it is used as possible. Things that change together live together.

Every rule below is a consequence of it. When two rules seem to conflict, the one that
keeps co-changing code together wins.

## Where does this go? (decision rule)

Count the consumers. That is the whole algorithm.

| Consumers | Location |
|---|---|
| 1 | Same file as the consumer |
| 1, and the file is getting long | Sibling file in the consumer's own folder |
| 2+ within one feature/route | That feature's folder (`constants.ts`, `helpers.ts`, `hooks/`) |
| 2+ across features | Shared top-level (`lib/`, `utils/`, `components/`) |
| Environment-derived | `config/` — and nothing else goes there |

**Promote on the second consumer, never in anticipation of one.** Moving code up later is
cheap and mechanical. Guessing wrong up front produces a shared folder full of
single-consumer code that nobody dares delete.

Never demote silently: if shared code turns out to have one consumer, move it back.

## Grouping: by feature, not by type

Group folders by **what the app does**, not by what the files are.

```
✗ components/  hooks/  utils/  types/      ← every feature smeared across four folders
✓ features/checkout/{components,hooks,api,utils}
```

`components/hooks/utils` at the top level are for **genuinely shared** code only.

Small app (< ~15 components): a flat `components/` folder is fine. Move to features when
you can no longer find things by name, not on a schedule.

**Deletion test:** deleting a feature folder should break nothing except its call sites.
If it breaks unrelated code, the boundary is wrong.

## Boundaries

- Imports flow **one direction**: `shared → features → routes/pages`. Never back up.
- **Features do not import from each other.** Compose them one level up, at the route.
- If two features need the same thing, it is shared code — promote it, don't cross-import.

Enforce with ESLint `import/no-restricted-paths` rather than documentation. See
[reference/structure.md](reference/structure.md) for a working config.

## Splitting components

Split when one of these is true — not by line count:

- **Two responsibilities.** You change the component for two unrelated reasons.
- **Two states of one thing.** Loading / empty / loaded read better as early returns over a shared layout component than as nested ternaries in JSX.
- **A reuse site appears.** Second consumer, same rule as above.
- **The client boundary.** An interactive leaf inside otherwise-static markup (see Next.js below).

Do **not** split because a file "feels long". A 300-line component with one job is fine.
A 60-line component doing two things is not.

Prefer **composition over configuration**: a growing list of boolean props is the signal
to let the consumer assemble the pieces (`children`, slots, compound components) instead.
See [reference/components.md](reference/components.md).

## Where logic lives

Three homes, in order of preference:

1. **Pure function** — framework-agnostic business logic. Must not import React. Testable with no renderer.
2. **Custom hook** — React wiring: state, effects, subscriptions, calling the pure functions.
3. **Component** — rendering. Reads from hooks, calls handlers, returns JSX.

The test: *could this run in a Node script with no DOM?* If yes, it is a pure function and
does not belong in a hook.

Pragmatism guard: a component with a few lines of logic does not need three files. Extract
on the second reason to, not the first.

**Do not use container/presentational splitting.** Its own author retracted it — custom
hooks replaced it. Do not introduce `FooContainer` wrappers in new code.

## Constants

- Used once → `const` at module top of that file.
- Used across a feature → that feature's `constants.ts`.
- Used app-wide and never changes → shared `constants.ts`.
- Read from the environment → `config/`, which is the **only** thing that folder holds.

A global `constants.ts` that everything imports is a dependency magnet. Keep it small; it
is not a home for values that merely lack an obvious owner.

## Barrel files

Default: **import directly from the defining file.**

`export *` defeats tree-shaking, inflates the module graph, and slows builds, linting and
type-checking. A single-component `index.ts` re-export is acceptable if the project already
does it consistently. Never add a barrel that re-exports a whole directory of features.

## Next.js App Router

Routing shape and architecture are different axes. Keep them apart:

- **`app/` is for routing and composition only** — `page`, `layout`, `loading`, `error`, and the wiring that assembles a screen.
- Real code lives outside it (`features/`, `lib/`), or in `_private` folders when genuinely route-local.
- Pages stay **synchronous compositors**: they arrange `Suspense` boundaries and place components.
- Async server components **fetch their own data**. Do not thread props down from a page-level loader — that is what makes a component reusable across routes.
- Push `'use client'` to the **smallest leaf** that needs state, handlers or browser APIs. Pass server components through as `children` — they do not join the client bundle.
- Server Actions live with the domain they mutate (`actions.ts`), stay thin, and delegate to a data-access module. Never a global `actions/` folder.
- Data access belongs in a `server-only` module that performs its own authorization and returns narrow DTOs. A page-level auth check does **not** protect a Server Action defined in it.

Details and the reasoning: [reference/nextjs.md](reference/nextjs.md).

## Review checklist

When reviewing a diff for structure:

- [ ] New file in the narrowest location its consumers allow?
- [ ] Anything added to a shared folder that has exactly one consumer?
- [ ] Any cross-feature import?
- [ ] Business logic that imports React but need not?
- [ ] A new boolean prop where composition would do?
- [ ] A new `export *`?
- [ ] `'use client'` added above the leaf that needs it?
- [ ] Server Action or data access without its own authorization check?

## Reference

Load only what the task needs:

- [reference/structure.md](reference/structure.md) — folder layouts, the growth path from flat to monorepo, ESLint boundary enforcement, naming.
- [reference/components.md](reference/components.md) — splitting criteria, composition patterns, where state lives.
- [reference/logic.md](reference/logic.md) — business logic placement, hooks vs pure functions, constants, utils vs helpers.
- [reference/nextjs.md](reference/nextjs.md) — App Router architecture, RSC boundary, Server Actions, data access layer.
- [README.md](README.md) — sources behind every rule here, and where they disagree.
