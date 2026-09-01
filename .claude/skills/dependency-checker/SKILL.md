---
name: dependency-checker
description: "Audit the dependencies of this repo — the external packages of every component and the internal wiring between components — and produce a structured report with a diagram, weight tables, prioritised findings and advice. Use whenever someone asks what a package costs, whether a dependency can be dropped, why an install is so large, how the packages depend on each other, before adding a new dependency, or when an upgrade in one package breaks another. Also use when asked to draw or explain the component graph."
---

# Dependency checker

DevDigest is five independent packages that only look like a monorepo. Almost every
mistake in a dependency review here comes from assuming otherwise, so read the next
section before running anything.

## What this repo actually is

**It is not a workspace.** No `package.json` declares `workspaces`, and nothing hoists.
`server`, `client`, `reviewer-core`, `mcp` and `e2e` each have their own manifest, their
own lockfile and their own `node_modules`. A dependency shared by four packages is
installed four times — `typescript` alone is ~22 MB in each of five trees. Do not report
that as duplication to be fixed; it is what "not a workspace" costs, and the fix is a
workspace migration, not a dependency change.

**The package managers are mixed.** `server`, `client` and `mcp` are pnpm; `reviewer-core`
and `skill-evals` are npm. Run each package's own manager, and never `npm install` in a
pnpm package — it will produce a second lockfile that silently disagrees with the first.
`e2e` already has both `package-lock.json` and `pnpm-lock.yaml`; that is a finding, not a
quirk.

**Components are wired by tsconfig path aliases, not by dependencies.** This is the single
most important fact. `server` reaches `@devdigest/reviewer-core` through an alias to
`../reviewer-core/src/index.ts` — the raw TypeScript source, not a build. `mcp` and
`reviewer-core` both alias `@devdigest/shared` to `../server/src/vendor/shared/`. None of
this appears in any `package.json`, so `npm ls`, `pnpm why` and every SCA tool see five
unrelated projects. **The internal graph exists only in `tsconfig.json` files.** Read them.

**`@devdigest/shared` exists in two copies** — `client/src/vendor/shared/` and
`server/src/vendor/shared/` — and the alias name is identical in both. Two packages point
at the server copy, one at the client copy. When the copies drift, the type error appears
in whichever package rebuilds first, far from the edit that caused it.

**`reviewer-core` pins `zod` to its own `node_modules`** via an alias. That is deliberate:
the vendored contracts are zod 3 while other packages are on zod 4. Do not report the pin
as redundant, and do not propose unifying the zod versions without saying what happens to
the vendored copies.

**`dependency-cruiser` is already a `server` dependency**, wired through
`src/adapters/depgraph/`. Use it for module-level graphs inside `server`; do not add a
second graph tool.

## Procedure

**1. Measure. Do not estimate.**

```bash
node .claude/skills/dependency-checker/scripts/scan.mjs . --json /tmp/deps.json
```

Under a second on this repo. It emits packages, their managers and lockfiles, per-package
installed size, per-dependency weight, the internal alias edges, and any alias whose name
resolves to more than one file. It measures and judges nothing — the judgement is yours.

Two things it handles that a hand-rolled `du` will not: pnpm symlinks only *direct*
dependencies into `node_modules/`, with everything transitive under `.pnpm/`, so a naive
walk understates a pnpm package by most of its weight; and tsconfig path maps contain
`"@/*"` and `"./src/*"`, which a regex comment-stripper mistakes for a block comment and
silently corrupts. Re-run the script rather than reimplementing either.

If `node_modules` is missing for a package, its weights are zero and the script says so in
`notInstalled`. Say that in the report instead of comparing an uninstalled package to an
installed one.

**2. Read `totalBytes` and `exclusiveBytes` as different questions.** `total` is what a
dependency drags in. `exclusive` is what actually disappears if you remove it — the part
no other dependency also needs. They diverge sharply: `@testcontainers/postgresql` totals
~24 MB in `server` but is exclusively ~0.4 MB, because it shares 128 packages with
`testcontainers`. **Every removal recommendation must quote `exclusive`.** A recommendation
that quotes `total` is wrong by roughly the amount it overstates.

**3. Check the invariants above by hand.** The script reports the facts; whether a
two-copy alias has drifted, or a raw-source alias now crosses a version boundary, needs
you to open the files.

## Report structure

Write to `docs/dependencies/<date>-report.md`. Five sections, in this order.

**1. Summary.** One table — package, manager, prod/dev counts, installed size — then at
most five sentences on the state of things. Lead with anything from the invariants section
that is currently broken.

**2. Component graph.** A mermaid `flowchart LR` of the five packages and the alias edges
between them. Solid arrow for an alias into a built entry point, **dashed for an alias
into raw source**, and label each edge with the alias name. Mark the duplicated
`@devdigest/shared` target explicitly — a reader who cannot see the two copies in the
diagram has not been told the main thing. Load the `mermaid-diagram` skill for syntax
rather than guessing it.

**3. Weight.** One table per package, top ten dependencies, columns: package, kind
(prod/dev), total, exclusive, transitive count. Sort by `exclusive` descending, because
that is the order in which removals pay. State the totals per package and for the repo.

**4. Findings, prioritised.** Use these three tiers and say which tier each finding is in:

- **P1 — can produce a wrong artifact.** Two lockfiles in one package; copies of a
  vendored contract that have drifted; an alias into raw source that crosses a runtime
  version boundary; a production dependency that only resolves at compile time. These are
  correctness problems wearing a dependency costume, and they ship silently.
- **P2 — weight with a cheap fix.** Large `exclusive` size, few import sites. Quote both
  numbers: the megabytes and the number of files that would have to change.
- **P3 — hygiene.** Unused declarations, a dev dependency declared as prod, versions
  drifting between packages, stale majors. Real, but nothing breaks tomorrow.

**5. Recommendations.** One line each, ordered by tier then by `exclusive`. Every line
carries the number that justifies it and the concrete first step. "Consider reducing
bundle size" is not a recommendation; "drop `mermaid` from `client` (114 MB total, 112 MB
exclusive, 102 packages, imported in 2 files) and render diagrams server-side" is.

## What is not a finding

Say explicitly that you checked these, so the reader knows the report is complete:

- The same dependency installed in several packages. That is the no-workspace design.
- `reviewer-core`'s `zod` alias pin. Deliberate, and load-bearing.
- Large dev-only weight (`vitest`, `typescript`, `testcontainers`) in a package that is
  never shipped. Note it, do not prioritise it.
- `agent-runner/dist` being committed — it ships as a GitHub Action and is committed on
  purpose; `.gitignore` says so.
- A package with a lockfile but no `node_modules`. That is an uninstalled checkout, not a
  dependency problem.
