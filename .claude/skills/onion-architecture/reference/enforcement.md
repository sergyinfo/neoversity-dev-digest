# Enforcement

Documentation does not hold a boundary. `server/.dependency-cruiser.cjs` does.

```sh
cd server && pnpm lint:arch
```

`dependency-cruiser` was already a dependency here — used at runtime by the repo-intel
indexer to build import graphs — but had no architecture config. The rules cost nothing to
add.

## Baseline

Introduced against a live codebase, so rules with outstanding violations start at `warn`
and only clean rules are `error`. **A rule that fails the build on day one gets disabled by
the first person in a hurry.**

At introduction: **16 warnings, 0 errors, exit 0.**

| Rule | Severity | Outstanding |
|---|---|---|
| `no-composition-root-in-adapters` | `error` | 0 |
| `no-circular` | `warn` | 5 |
| `no-sql-in-routes` | `warn` | 4 |
| `no-orphans` | `warn` | 2 |
| `no-inward-to-outward` | `warn` | 2 |
| `no-concrete-adapters-in-app-layer` | `warn` | 2 |
| `no-cross-module-imports` | `warn` | 1 |

`warn` records migration state, not permission. A new violation of a warn-level rule is a
review failure.

## Writing the rules

Paths are **regular expressions**, not globs, matched against forward-slash paths.

```js
{
  name: 'no-sql-in-routes',
  severity: 'warn',
  from: { path: 'src/modules/[^/]+/routes\\.ts$' },
  to:   { path: '^src/db/' },
}
```

Backreferences work across `from` and `to`, which is what makes the cross-module rule
possible — `$1` in `to.pathNot` refers to the group captured in `from.path`:

```js
{
  name: 'no-cross-module-imports',
  from: { path: '^src/modules/([^/]+)/' },
  to: {
    path: '^src/modules/([^/]+)/',
    pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
  },
}
```

## Two mistakes made while writing this config

Both were caught by running it, not by reading it. Worth repeating because they are the
generic failure modes.

**1. The rule was too broad.** `no-adapters-to-platform` forbade `adapters/ → platform/`
entirely and produced 7 violations that were all legitimate: adapters import
`platform/errors`, `platform/resilience` and `platform/structured`, which are cross-cutting
*utilities*, not the composition root. Narrowed to
`platform/(container|jobs).ts` and renamed `no-composition-root-in-adapters`; it is now
clean and meaningful.

*A rule with many "violations" that all look reasonable is a wrong rule, not a dirty
codebase.*

**2. Line-based matching undercounts.** A first attempt to measure SQL in routes with
`grep -c "container\.db\.(select|insert)"` reported 7 queries. The real number is 24 —
Drizzle chains break across lines:

```ts
const [repo] = await container.db
  .select()          // ← invisible to a line-based grep
  .from(t.repos)
```

The lint rule matches the **import**, not the call site, which is immune to formatting.
Any ad-hoc measurement should be multi-line aware.

## Options that matter

```js
options: {
  exclude: { path: '^src/vendor/' },   // shared vocabulary, not part of the layer graph
  tsConfig: { fileName: 'tsconfig.json' },
  tsPreCompilationDeps: true,          // sees type-only imports — needed for the AgentRow leak
  doNotFollow: { path: 'node_modules' },
}
```

`tsPreCompilationDeps` is what makes type-only imports visible. Without it, a service
importing a database row *type* looks clean while still coupling the layers.

`src/vendor/` is excluded deliberately: contracts and ports are the shared vocabulary every
ring may use, and they resolve through a tsconfig path alias rather than a real dependency.

## CI

Add alongside the existing typecheck step:

```yaml
- run: pnpm lint:arch
  working-directory: server
```

Exit code is non-zero only on `error`-severity violations, so this is safe to add now and
gets teeth as rules are promoted.

## Adding a rule

1. Write it at `severity: 'info'` and run — see what it actually catches.
2. If most hits look legitimate, the rule is wrong. Narrow it.
3. Once the true violations are known, set `warn` and record the count in SKILL.md.
4. Fix them, then promote to `error` in the same PR that reaches zero.
