# Research — frontend architecture & code organization

Source material for a planned skill answering: **where components live, how they are
split, where constants / utils / helpers / business logic go.**

Collected 2026-08-02. Every entry says what it actually contributes, so the skill can
be written from this file without re-reading everything.

---

## Why a new skill (gap analysis)

The repo already has `.claude/skills/react-best-practices/`. It is a **rules and
anti-pattern catalog** — 175 lines, tagged by severity. Its `## Code Organization`
section is **7 lines**:

```
### Feature-Based Structure
- Colocate component + hook + helpers + tests per feature
- Shared utilities go in `utils/` or `components/ui/`
### File Quality
- Order: imports, constants, helpers, component, exports
- Reuse existing types and constants over creating new ones
```

That is a summary, not an architecture guide. It does not answer: when to split a
component, when a util is promoted from local to shared, where business logic lives,
how to enforce boundaries, or what to do as the project grows.

`next-best-practices/` (3.4k lines) covers App Router file conventions, RSC validity rules,
data-fetching patterns and caching — framework mechanics, not architecture. Grepped for
`features/`, "business logic", "domain", "colocat": **zero hits.** Its `file-conventions.md`
"Project Structure" section is a list of the files Next.js recognises inside `app/`, which
says nothing about where the rest of the code goes.

So the new skill **complements** both; it should not restate their rules. Sharpest way to
put the boundary: the existing skills answer *"what does the framework do with this file?"*,
the new one answers *"which file should this code be in?"*.

---

## Tier 1 — canonical, decide the skill's spine

### 1. Bulletproof React — project structure
<https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md>

The most widely cited concrete React architecture. Gives a full folder tree
(`app/ components/ config/ features/ hooks/ lib/ stores/ types/ utils/`), a per-feature
internal tree (`api/ assets/ components/ hooks/ stores/ types/ utils/`), and — most
valuable — **machine-enforceable boundaries**:

> "the code should flow in one direction, from shared parts of the code to the
> application (shared -> features -> app)"

Ships ESLint `import/no-restricted-paths` zones that forbid cross-feature imports and
enforce the unidirectional flow. **This is the single most actionable artifact found** —
a rule an agent can apply and a linter can verify. Also states: import directly, not
through barrel files, to keep tree-shaking working.

### 2. Feature-Sliced Design
<https://feature-sliced.design/docs/get-started/overview> ·
<https://github.com/feature-sliced/documentation>

The formal methodology. Three axes: **layers** (app → pages → widgets → features →
entities → shared), **slices** (business domains inside a layer), **segments**
(technical purpose inside a slice: `ui`, `api`, `model`, `lib`, `config`).

Two rules worth stealing verbatim:
- "Modules on one layer can only know about and import from modules from the layers strictly below."
- "Slices cannot use other slices on the same layer."

The `model` segment is FSD's answer to *where business logic goes* — schemas, stores,
business logic, separate from `ui` and `api`. Heavier than most projects need, but the
segment vocabulary is a clean answer to the user's question.

### 3. Kent C. Dodds — Colocation
<https://kentcdodds.com/blog/colocation>

The principle underneath every feature-based structure:

> "Place code as close to where it's relevant as possible."
> "Things that change together should be located as close as reasonable."

Names the three costs of separation: **synchronization** (files drift), **discoverability**
(you miss what you should have updated), **cognitive load** (context switching).

Also gives the *exceptions*, which the skill needs so colocation isn't applied blindly:
E2E tests stay at the root because they span the app and shouldn't need edits during a
refactor; system-wide docs can live in feature READMEs.

### 4. React docs — Thinking in React
<https://react.dev/learn/thinking-in-react>

Official answer to **how to split a component**. Three lenses: the programming lens
(single responsibility — "a component should ideally only be concerned with one thing"),
the CSS lens (what would you write class selectors for), the design lens (layer
structure). Plus the data-model rule: "If your JSON is well-structured, it naturally maps
to your component structure."

Step 4 is the official algorithm for **where state lives**: find every component that
renders from the state → find their closest common parent → put it there (or above).
This is the citable rule for state placement.

### 5. Next.js — Project structure and organization
<https://nextjs.org/docs/app/getting-started/project-structure>

Relevant because this repo's client is Next.js App Router. Explicitly **unopinionated**:
"choose a strategy that works for you and your team and be consistent."

Concrete mechanics the skill must mention: files are **safely colocatable** inside `app/`
(a folder is not routable without `page`/`route`), `_folder` private folders opt a subtree
out of routing, `(group)` route groups organize without touching the URL. Lists three
strategies: project files outside `app/`, in top-level folders inside `app/`, or split by
feature/route.

### 6. Vercel Labs — agent-skills
<https://github.com/vercel-labs/agent-skills>

**Format reference and content source.** Vercel ships agent skills in exactly the shape
we're building: `SKILL.md` + a `rules/` directory of one-rule-per-file, prioritized by
impact.

Two of its skills are directly on-topic:
- `composition-patterns` — `architecture-avoid-boolean-props`, `architecture-compound-components`, `state-lift-state`, `state-context-interface`, `state-decouple-implementation`, `patterns-children-over-render-props`, `patterns-explicit-variants`. Core thesis: **composition over configuration** — let consumers assemble components instead of growing a prop interface.
- `react-best-practices/rules/bundle-barrel-imports.md` — <https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/bundle-barrel-imports.md>

---

## Tier 2 — practical, fills in the "how it evolves" story

### 7. Robin Wieruch — React Folder Structure Best Practices
<https://www.robinwieruch.de/react-folder-structure/>

The best **staged progression**: single file → multiple files → component folders →
technical folders → feature folders → domain folders → packages → monorepo, each with a
stated trigger for moving on. Directly answers the promotion question:

> "React Hooks which are still only used by one component should remain in the component's file… Only reusable hooks end up in the new hooks/ folder."
> "The moment a second feature needs the same logic… The right move is to promote it back up to the shared utils/ folder."
> "Code flows in one direction. From shared utilities into features, and from features into pages. Never the other way around."

Naming convention: singular for a feature folder (`customer`), plural for collections
(`features/`, `hooks/`, `utils/`).

### 8. Josh W. Comeau — Delightful React File/Directory Structure
<https://www.joshwcomeau.com/react/file-structure/>

**The dissenting view, and worth keeping for exactly that.** Organizes *by function*, not
by feature: `components/ hooks/ helpers/ utils.ts constants.ts`. One folder per component
with `index.ts` re-export, sub-components and `Foo.helpers.ts` colocated in the folder.

Useful distinction the skill should adopt: **`helpers/` = project-specific**, **`utils.ts`
= generic and portable across projects**. Also honest about the trade-offs he accepts
(barrel-file build overhead, App Router friction, doesn't segment features).

### 9. TkDodo — Component Composition is great btw
<https://tkdodo.eu/blog/component-composition-is-great-btw>

On splitting components by *state* rather than by nesting conditionals: extract the shared
layout into a `children`-taking component, then use **early returns** per state (pending /
empty / loaded). Notable line — "The duplication is not only fine, it will also help the
component evolve better" — and the smell test: if a layout component needs ever more
conditional props, it's "the wrong abstraction."

### 9a. Felix Gerschau — Separation of concerns with React hooks
<https://felixgerschau.com/react-hooks-separation-of-concerns/>

The cleanest **three-way split** found, and the direct answer to "where does business
logic go":

- **Component** — rendering only.
- **Custom hook** — state, event handlers, React-specific wiring.
- **Plain function** — framework-agnostic business logic, testable "with any Node.js
  testing library, which doesn't even need to support React components."

Includes the pragmatism guard the skill needs so this isn't applied to every component:
"If a component has only a few lines of JS, it's not necessary to separate the logic."

### 9b. Clean Architecture on the frontend
<https://feature-sliced.design/blog/frontend-clean-architecture> ·
<https://bespoyasov.me/blog/clean-architecture-on-frontend/>

The heavier end of the same idea: a domain layer of entities and use cases that never
imports React, with the Dependency Rule pointing inward. FSD's own post is the more
grounded of the two because it maps the layers onto a structure people actually ship.

Take the *direction* rule and the "domain logic must not import React" test; leave the
full entities/use-cases/ports ceremony unless the app genuinely warrants it.

### 10. Sandro Roth — How to structure your React projects
<https://sandroroth.com/blog/project-structure/>

Secondary walkthrough that lands close to bulletproof-react. Useful as corroboration.

### 11. React Handbook — Project Standards
<https://reacthandbook.dev/project-standards>

Broader project-standards framing (linting, conventions) around the same structure ideas.

---

## Tier 3 — counterpoints and dead ends (the skill should say *why not*)

### 12. Dan Abramov — Presentational and Container Components
<https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0>

**Retracted by its own author.** The article carries his update: *"I don't suggest
splitting your components like this anymore."* Since hooks (16.8), stateful logic goes in
a custom hook instead of a wrapper component. Still commonly cargo-culted, so the skill
should name it explicitly as superseded — while noting his caveat that it's fine "if you
find it natural in your codebase."

### 13. Atomic Design — original + critiques
<https://atomicdesign.bradfrost.com/chapter-2/> ·
<https://cheesecakelabs.com/blog/rethinking-atomic-design-react-projects/> ·
<https://www.qt.io/software-insights/atomic-design-systems-why-the-labels-dont-matter>

The atoms/molecules/organisms taxonomy. Recurring criticism: the molecule/organism
boundary is **not decidable** — teams argue over classification because it sorts by
complexity rather than by function. Verdict for the skill: keep the *hierarchical
composition* idea, drop the taxonomy.

### 14. Barrel files — the case against
<https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/bundle-barrel-imports.md> ·
<https://github.com/vercel/next.js/issues/12557> ·
<https://uglow.medium.com/burn-the-barrel-c282578f21b6>

`export *` defeats tree-shaking; reported bundle near-doubling on a Material-UI button
import; Next.js added `optimizePackageImports` to work around it, with 15–70% faster dev
builds when barrels are bypassed. Also slows type-checking, linting and test startup by
inflating the module graph.

### 15. Package by feature vs package by layer / Screaming Architecture
<https://www.ensonodigital.com/blog/packaging-by-layer-versus-packaging-by-feature> ·
<https://thetshaped.dev/p/screaming-architecture-and-colocation-nodejs-typescript-react>

The general (non-React) argument: layer packaging gives low cohesion inside a package and
high coupling between packages. The pragmatic resolution — **features at the top level,
layers within each feature** — is what bulletproof-react and FSD both implement.

---

## Next.js App Router — architecture (not performance)

The existing `next-best-practices` skill (3.4k lines) is **framework mechanics**: which
files Next recognises, RSC validity rules, data-fetching patterns, caching. Verified by
grep — it contains **zero** occurrences of `features/`, "business logic", "domain" or
"colocation" as an organising idea. So the architectural axis below does not overlap it.

The central tension to resolve: **`app/` is shaped by routing, feature architecture wants
`features/`.** Every good source resolves it the same way — `app/` holds routing and
composition only, real code lives outside it.

### 16. Next.js — Data Security guide  ⭐ framework-official architecture
<https://nextjs.org/docs/app/guides/data-security>

The strongest architectural statement Vercel makes, and it is not about performance. Names
**three data-fetching architectures** and says to pick one and not mix: external HTTP APIs
(existing orgs), **Data Access Layer (recommended for new projects)**, component-level
access (prototypes only).

The DAL rules are directly quotable as skill rules:

> A Data Access Layer should: Only run on the server. Perform authorization checks. Return safe, minimal Data Transfer Objects (DTOs).
> Secret keys should be stored in environment variables, but only the Data Access Layer should access `process.env`.

Also: `"use server"` actions stay **thin** and delegate to the DAL — "This keeps
authentication, authorization, and database logic in a dedicated `server-only` module."
And the critical trap: "A page-level authentication check does not extend to the Server
Actions defined within it" — a Server Action is a separate entry point reachable by direct
POST, so it must re-verify.

Ends with an **audit checklist** (DAL isolation, `"use client"` prop breadth, `"use server"`
validation/authz, bracket folders as user input) that is essentially a ready-made review
rubric.

### 17. Aurora Scharff — Component Architecture for React Server Components  ⭐
<https://aurorascharff.no/posts/component-architecture-for-react-server-components/>

The best piece found on **reconciling feature folders with RSC**. Uses `features/<domain>/components/`
with server components, their skeletons and client leaves side by side.

Three rules worth taking verbatim:
- **"Async components fetch their own data"** — server components take minimal identifiers and resolve dependencies internally, instead of a parent loader passing props down. This is what lets a component be "picked up and composed into any page" without external wiring.
- **Pages stay synchronous** and act as *compositors* that arrange `Suspense` boundaries.
- **Suspense boundaries belong at the page level**, where the loading sequence is designed — not scattered through the tree.
- Colocate the skeleton with its component, exported from the same file.

### 18. The `'use client'` boundary as an architectural seam
<https://nextjs.org/docs/app/getting-started/server-and-client-components> ·
<https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/>

`'use client'` marks a boundary between two module graphs. Everything a client module
**imports** joins the client bundle — but components passed as `children` or props do
**not**; they render on the server and arrive as output. That asymmetry is the whole
composition technique: keep server components at the top, push `'use client'` to the
smallest leaf that needs state, handlers or browser APIs, and pass server content through
as `children`.

The failure mode to name explicitly: `'use client'` at the top of a root layout, which
"effectively turns your whole app back into a Vite-style SPA."

### 19. Server Actions placement
<https://nextjs.org/docs/app/guides/server-actions> ·
<https://github.com/orgs/community/discussions/184740>

Community consensus, consistent with the DAL guidance: colocate actions with the domain
they mutate (`features/<domain>/actions.ts`), do **not** create a global `actions/` folder —
it recreates the layer-packaging problem. Client Components can only call actions defined
in a separate file with the module-level `'use server'` directive, which conveniently
forces a clear file-level seam between browser and server code.

### Next.js mechanics that serve architecture

From the official project-structure page (source 5), the three features that make the
`app/`-is-routing-only split work in practice:

- **Colocation is safe** — a folder is not routable without `page`/`route`, so support files can sit next to a route.
- **`_folder`** opts a subtree out of routing entirely — the escape hatch for `_components`, `_lib`.
- **`(group)`** organises routes by section/team without touching the URL.

---

## Where the sources actively disagree

These are the decisions the skill has to *make*, not summarize. Listing them so the
disagreement isn't accidentally flattened into false consensus.

| Question | Position A | Position B |
|---|---|---|
| Group by feature or by function? | Feature — bulletproof-react, FSD, Wieruch, screaming architecture | Function — Josh Comeau, who argues IDE search makes feature segmentation unnecessary |
| Barrel files (`index.ts`) | Avoid — bulletproof-react, Vercel, Next.js issue #12557 | Fine in practice — Comeau (~180 barrels, calls the cost negligible) |
| How much structure up front? | Full layer/slice/segment taxonomy — FSD | Start flat, promote only under pressure — Wieruch's staged progression |
| Business logic home | Custom hooks — most React-native sources | Framework-agnostic pure functions, hooks only as the React adapter — Gerschau, FSD `model` segment, clean-architecture posts |
| Who fetches data (RSC) | Page/parent loads and passes props down | Each async server component fetches its own — Scharff, and it is what makes components composable across pages |

Note the last row is **not** a free choice: with RSC it interacts with where `Suspense`
goes. Parent-loads centralises the waterfall risk; component-fetches needs the page to own
the `Suspense` layout deliberately.

Unresolved and worth a decision when writing: **where do constants actually go?** This is
the weakest-sourced question — most results are low-quality listicles recommending a
global `constants.js`, which contradicts colocation. The defensible synthesis from the
better sources: colocate constants with their only consumer, promote to a feature-level
`constants.ts` on the second consumer, and reserve a global `config/` for
environment-derived values only (bulletproof-react's `config/` is explicitly "global
configurations and exported env variables", not a dumping ground).

---

## Not yet fetched

Both are on `profy.dev`, which **failed DNS resolution twice** during this research
(`getaddrinfo ENOTFOUND profy.dev`) — the domain was unreachable, not the pages. Retry
before writing the skill; neither is load-bearing now, but both would sharpen it.

- `profy.dev/article/react-folder-structure` — the most direct like-for-like comparison
  found of flat / by-type / feature-driven / screaming / atomic structures.
- `profy.dev/article/react-architecture-business-logic-and-dependency-injection` — part 6
  of a clean-architecture series. The business-logic question is now covered by Gerschau
  and the FSD clean-architecture post instead, so this is a nice-to-have.
