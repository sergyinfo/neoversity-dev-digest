# frontend-ui-architecture — sources

Every rule in this skill traces to something below. Where sources disagreed, the choice
made and the reason are recorded in [Decisions](#decisions-where-sources-disagree).

**Version 1.0.0** · researched 2026-08-02.

## Scope

Answers **where code goes and how it is split**. Deliberately silent on performance,
styling, testing technique and framework mechanics — those belong to the sibling skills
`react-best-practices` (rules and anti-patterns) and `next-best-practices` (App Router
mechanics, RSC validity, caching).

Boundary in one line: the sibling skills answer *"what does the framework do with this
file?"*; this one answers *"which file should this code be in?"*.

## Canonical

| Source | What it contributes |
|---|---|
| [Bulletproof React — project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | The reference folder tree, the unidirectional `shared → features → app` rule, and the ESLint `import/no-restricted-paths` config that enforces it |
| [Feature-Sliced Design](https://feature-sliced.design/docs/get-started/overview) · [docs repo](https://github.com/feature-sliced/documentation) | Layers / slices / segments vocabulary; "slices cannot use other slices on the same layer"; the `model` segment as a home for business logic |
| [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) | The prime principle, the three costs of separation (sync, discoverability, cognitive load), and the stated exceptions (E2E tests stay at the root) |
| [React docs — Thinking in React](https://react.dev/learn/thinking-in-react) | The four lenses for splitting a component; the official algorithm for where state lives |
| [Next.js — Project structure](https://nextjs.org/docs/app/getting-started/project-structure) | Safe colocation inside `app/`, `_folder` private folders, `(group)` route groups; explicitly unopinionated about the rest |
| [Next.js — Data Security](https://nextjs.org/docs/app/guides/data-security) | The Data Access Layer pattern, DTOs, `server-only`, and the rule that a page-level auth check does not protect a Server Action |
| [Vercel Labs — agent-skills](https://github.com/vercel-labs/agent-skills) | Skill format reference; `composition-patterns` (composition over configuration, compound components, children over render props) |

## Practical

| Source | What it contributes |
|---|---|
| [Robin Wieruch — React Folder Structure](https://www.robinwieruch.de/react-folder-structure/) | The staged growth path with a trigger per stage; the promotion rule ("the moment a second feature needs the same logic"); singular/plural naming |
| [Aurora Scharff — Component Architecture for RSC](https://aurorascharff.no/posts/component-architecture-for-react-server-components/) | Feature folders under RSC; async components fetch their own data; pages as synchronous compositors; Suspense at the page level |
| [Felix Gerschau — Separation of concerns with hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) | The component / hook / pure-function split, and the pragmatism guard against over-extracting |
| [TkDodo — Component Composition is great btw](https://tkdodo.eu/blog/component-composition-is-great-btw) | Splitting by state with early returns over a shared layout; "the wrong abstraction" test |
| [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) | The `utils` (portable) vs `helpers` (project-specific) distinction; the dissenting by-function view |
| [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | How the `'use client'` module-graph boundary works and why `children` escape it |
| [FSD — Clean Architecture in Frontend](https://feature-sliced.design/blog/frontend-clean-architecture) · [Bespoyasov — Clean Architecture on Frontend](https://bespoyasov.me/blog/clean-architecture-on-frontend/) | The dependency direction rule and the "domain must not import React" test |
| [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/) | Corroborates the bulletproof-react layout |
| [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) | Broader project-standards framing |
| [Next.js folder structure discussion](https://github.com/orgs/community/discussions/184740) | Community consensus on colocating Server Actions by domain |

## Counterpoints — why the skill rejects these

| Source | Why it is here |
|---|---|
| [Dan Abramov — Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) | **Retracted by its author**: "I don't suggest splitting your components like this anymore." Hooks replaced it. Still widely cargo-culted, so the skill names it explicitly |
| [Atomic Design](https://atomicdesign.bradfrost.com/chapter-2/) · [Rethinking Atomic Design](https://cheesecakelabs.com/blog/rethinking-atomic-design-react-projects/) · [Why the labels don't matter](https://www.qt.io/software-insights/atomic-design-systems-why-the-labels-dont-matter) | The molecule/organism boundary is not decidable; it sorts by complexity, not function. Keep hierarchical composition, drop the taxonomy |
| [Vercel — barrel imports rule](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/bundle-barrel-imports.md) · [next.js#12557](https://github.com/vercel/next.js/issues/12557) · [Burn the Barrel](https://uglow.medium.com/burn-the-barrel-c282578f21b6) | `export *` defeats tree-shaking and inflates the module graph, slowing builds, linting and type-checking |
| [Packaging by layer vs by feature](https://www.ensonodigital.com/blog/packaging-by-layer-versus-packaging-by-feature) · [Screaming Architecture & Colocation](https://thetshaped.dev/p/screaming-architecture-and-colocation-nodejs-typescript-react) | The general argument that layer packaging yields low cohesion and high coupling |

## Decisions (where sources disagree)

Five real disagreements. The skill takes a position on each rather than presenting both.

**1. Group by feature or by function?** → **Feature**, with by-type acceptable while small.

Bulletproof React, FSD, Wieruch and the screaming-architecture literature all say feature.
Josh Comeau dissents, organizing by function and arguing IDE search makes feature
segmentation unnecessary. His argument holds for a personal-scale codebase and stops
holding for a team, where ownership and the deletion test matter more than findability.

**2. Barrel files?** → **Import directly.** A single-component `index.ts` is tolerated.

Measured costs (bundle size, build and type-check time) beat ergonomic preference. Comeau
accepts the cost knowingly; most projects pay it without knowing.

**3. How much structure up front?** → **Start minimal, promote under pressure.**

Wieruch's staged progression over FSD's full taxonomy. FSD is excellent at scale and
over-engineering below it. The skill keeps FSD's *vocabulary* while adopting Wieruch's
*timing*.

**4. Where does business logic live?** → **Pure functions; hooks are the React adapter.**

Most React writing says "custom hooks" and stops. Gerschau, FSD's `model` segment and the
clean-architecture sources are more precise: hooks are for React wiring, business rules are
plain functions. The "could this run in Node?" test operationalizes it.

**5. Who fetches data under RSC?** → **Each async component fetches its own.**

Scharff's position, because it is what makes a component composable into any route. Noted
in the skill as a genuine trade-off: it moves waterfall risk into the tree, so the page
must own `Suspense` deliberately.

## Weakest area

**Constants placement** has the thinnest sourcing. Most search results are low-quality
listicles recommending a global `constants.js`, which contradicts colocation. The skill's
rule — colocate, promote on the second consumer, reserve `config/` for environment-derived
values — is a synthesis from the better sources rather than a direct citation. Treat it as
the most revisable rule here.

## Not consulted

Two `profy.dev` articles (a folder-structure comparison and a business-logic deep-dive)
were unreachable during research — `getaddrinfo ENOTFOUND profy.dev`, twice. The domain was
down, not the pages. Worth retrying for a future revision; the business-logic question is
covered by Gerschau and the clean-architecture sources in the meantime.

## Changelog

**1.0.0** — 2026-08-02. Initial version. 19 sources, five documented decisions.
