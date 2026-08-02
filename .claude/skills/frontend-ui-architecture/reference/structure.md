# Folder structure

## Growth path

Structure is a response to pressure, not a starting point. Each stage has a trigger.

| Stage | Shape | Move on when |
|---|---|---|
| 1 | One file | It is hard to find things in it |
| 2 | One file per component | A component needs siblings — styles, tests, constants |
| 3 | Folder per component | Too many component folders to scan |
| 4 | Type folders: `components/ hooks/ utils/` | A feature's files are scattered across all of them |
| 5 | `features/<name>/` with local `components/ hooks/ utils/` | Twenty flat features are hard to navigate |
| 6 | `domains/<area>/features/<name>/` | One repo must ship several deployables |
| 7 | `packages/` — extracted, versioned | — |

Most apps are healthy at stage 4 or 5. Do not start at 6.

## Reference layout (stage 5)

```
src/
├── app/ or routes/       routing + composition only
├── features/
│   └── checkout/
│       ├── api/          requests + query hooks for this feature
│       ├── components/   feature-scoped components
│       ├── hooks/        feature-scoped hooks
│       ├── utils/        feature-scoped helpers
│       ├── constants.ts
│       └── types.ts
├── components/           genuinely shared UI
├── hooks/                genuinely shared hooks
├── lib/                  preconfigured third-party clients
├── utils/                generic, portable helpers
├── config/               environment-derived values ONLY
├── stores/               global state
└── types/                shared types
```

Include only the folders a feature actually needs. An empty `hooks/` folder is noise.

## `lib/` vs `utils/` vs `helpers/`

A distinction worth keeping because it makes the placement decision automatic:

- **`utils/`** — generic and portable. `formatCurrency`, `groupBy`. Could be copied into an unrelated project unchanged. No domain knowledge.
- **`helpers/`** — project-specific but not feature-specific. Knows your domain vocabulary.
- **`lib/`** — configured instances of third-party things. The API client, the query client, the analytics wrapper.

If a function knows what a "checkout" is, it is not a util.

## Naming

- Feature folders: **singular** — `customer/`, not `customers/`.
- Collections: **plural** — `features/`, `hooks/`, `components/`.
- One exported component per file, named the same as the file.
- Co-located siblings take the component's name: `FindingsPanel.tsx`, `FindingsPanel.test.tsx`, or the flat `helpers.ts` / `constants.ts` / `styles.ts` when the folder is already scoped to one component. Pick one and be consistent within a project.

## Enforcing boundaries

Documentation does not hold a boundary. A linter does.

```js
// eslint.config.js
'import/no-restricted-paths': ['error', {
  zones: [
    // features cannot import from each other
    {
      target: './src/features/checkout',
      from: './src/features',
      except: ['./checkout'],
    },
    // routes may import features; features may not import routes
    { target: './src/features', from: './src/app' },
    // shared code may not import features or routes
    {
      target: ['./src/components', './src/hooks', './src/lib', './src/utils', './src/types'],
      from: ['./src/features', './src/app'],
    },
  ],
}]
```

Add one zone per feature. Tedious, but it is the only rule in this document a machine can
verify, which makes it the most valuable one.

## Colocation limits

Colocation is the default, not an absolute:

- **E2E tests stay at the root.** They span the whole app and map to no single source file; a refactor should not move them.
- **Cross-cutting docs** can live in a feature `README.md`, but system-wide docs belong at the root.
- **Shared fixtures** used by many features are shared code like any other.

## Structures to avoid

**Atomic design (`atoms/molecules/organisms`).** The molecule/organism line is not
decidable — it sorts by complexity rather than by function, so teams argue about
classification instead of writing code. Keep the idea of hierarchical composition; drop
the taxonomy.

**Grouping by technical type at scale.** `components/` with 200 entries is a directory, not
an architecture. Cohesion inside each folder is low and coupling between them is high.

**A `containers/` folder.** See the note on container/presentational in
[logic.md](logic.md).
