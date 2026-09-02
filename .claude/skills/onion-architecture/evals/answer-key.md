# Answer key — onion-architecture. Do NOT give this to an executor.

Six plants per tier across three cases. Every fixture is comment-free.

Plants carry a **category**, and the category is the whole experiment:

- `ring` — a plain Onion dependency-rule violation. **Both v1 and v2 should catch it.**
  These are the control: if the arms diverge here, something other than the delta moved.
- `module` — a DevDigest module-boundary violation. **Only v2 can catch it**, because
  only v2 states the rule. Nothing in general Onion knowledge implies any of them; each
  one is a legal-looking sideways import between files in the same ring.

## case-1-digest-module

| # | Category | File:line | What |
|---|---|---|---|
| 1.1 | `module` | `src/modules/digest/service.ts:2` | `import { BriefService } from '../brief/service.js'` — reaches into another module's internals instead of depending on `container.brief` |
| 1.2 | `module` | `src/modules/digest/service.ts:3` | `import { runPipeline } from '../repo-intel/pipeline.js'` — bypasses the `container.repoIntel.*` facade |
| 1.3 | `ring` | `src/modules/digest/service.ts:1,9` | `import { OctokitGitHubClient }` and `new OctokitGitHubClient()` — application ring naming a concrete infrastructure class instead of the `GitHubClient` interface |

Decoys: `../_shared/context.js:4` and `../../platform/errors.js:5` are the two sanctioned
cross-directory imports and must NOT be reported; `modules/index.ts` registers `digest`
correctly and statically; `contract.ts` is zod-only with no framework import;
`repository.ts` implements the contract interface and its dependency points inward;
`routes.ts` parses, calls one service, shapes the response.

## case-2-feed-module

| # | Category | File:line | What |
|---|---|---|---|
| 2.1 | `module` | `src/plugins/autoload.ts:10,17` | `readdir` over `modules/` plus dynamic `await import(routes)` — registration is meant to be one static line in `modules/index.ts`, and `feed` is absent from that registry |
| 2.2 | `ring` | `src/modules/feed/contract.ts:1,19` | domain contract imports `FastifyRequest` and exports `feedQueryFromRequest(request)` — the web framework has been pulled into the innermost ring |
| 2.3 | `ring` | `src/modules/feed/repository.ts:6,12` | `import { FEED_MAX_PAGE } from './routes.js'` — infrastructure importing presentation, the dependency arrow reversed |

Decoys: `service.ts` depends on the `Clock` interface from `@devdigest/shared`, not a
clock implementation; `../_shared/schemas.js` is a sanctioned import; `repository.ts`
using the db client is correct for its ring; `routes.ts` does no business work.

## case-3-insights-module

| # | Category | File:line | What |
|---|---|---|---|
| 3.1 | `module` | `src/modules/insights/service.ts:5` | `import { conventionCache } from '../conventions/state.js'` — two modules sharing mutable state through a directly imported singleton |
| 3.2 | `ring` | `src/modules/insights/service.ts:19-26` | `this.db.execute(sql\`SELECT ...\`)` — application ring writing raw SQL that belongs in the repository, which already has the interface for it |
| 3.3 | `ring` | `src/modules/insights/routes.ts:19-30` | ranking, promotion and the `degraded` fallback are business decisions computed in the route handler instead of the service |

Decoys: `this.container.repoIntel.summarize()` at `service.ts:17` is the **correct** use
of the facade and is the sharpest decoy for plant 1.2 — a review that over-applies the
repo-intel rule will flag it; `../../platform/jobs.js:6` is sanctioned; `contract.ts` is
clean; `repository.ts` is correct in both direction and content.

## What the comparison should show

v1 and v2 should score the same on the six `ring` plants. The three `module` plants are
the delta: v2 states the rules, v1 has never heard of them. If v1 catches a `module`
plant anyway, that is worth knowing — it means the rule was guessable from the code and
did not need to be written down.
