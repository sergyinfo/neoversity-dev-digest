/**
 * Onion-architecture boundaries for @devdigest/api.
 *
 * The rule: dependencies point INWARD. An inner ring never imports an outer one.
 *
 *   delivery (routes)  →  application (service)  →  persistence (repository) → db
 *                      ↘  ports (vendor/shared/adapters.ts)  ↖  adapters/
 *                              composed in platform/container.ts
 *
 * Run: `pnpm lint:arch`. See .claude/skills/onion-architecture/ for the reasoning.
 *
 * Severities are deliberate: rules with a clean baseline are `error`, rules with
 * known outstanding violations are `warn` until the migration closes them, so the
 * build never starts red. See reference/migration.md for the order.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-sql-in-routes',
      comment:
        'HTTP handlers must not touch the database. Move the query into ' +
        'modules/<m>/repository.ts and call it from a service (or directly, for a ' +
        'module with no orchestration). Matches the import, not the call site: ' +
        'Drizzle chains break across lines and evade line-based matching.',
      severity: 'warn', // → error once pulls/polling/settings/workspace are migrated
      from: { path: 'src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^src/db/' },
    },
    {
      name: 'no-concrete-adapters-in-app-layer',
      comment:
        'Services and repositories depend on PORTS (vendor/shared/adapters.ts) and ' +
        'receive implementations from the container. Importing a concrete adapter ' +
        'welds the application layer to one vendor.',
      severity: 'warn', // → error once the pure helpers leave adapters/
      from: { path: 'src/modules/[^/]+/(service|repository)\\.ts$' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'no-inward-to-outward',
      comment:
        'db/ and adapters/ are outer rings. They must never import feature modules — ' +
        'that inverts the dependency direction. Outstanding: astgrep and depgraph read ' +
        'constants out of modules/repo-intel; those constants belong in the adapter or ' +
        'in platform/.',
      severity: 'warn', // → error once the two repo-intel constant imports are moved
      from: { path: '^src/(db|adapters)/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-composition-root-in-adapters',
      comment:
        'Adapters are leaves: they implement a port and are wired BY the container, so ' +
        'they must not reach back into it or into the job runner. Shared cross-cutting ' +
        'helpers (platform/errors, resilience, structured) are deliberately allowed — ' +
        'they are utilities, not the composition root.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/platform/(container|jobs)\\.ts$' },
    },
    {
      name: 'no-cross-module-imports',
      comment:
        'Feature modules are independent. Compose them at the route or in the ' +
        'container; shared code goes to modules/_shared or platform/. Outstanding: ' +
        'repos/service.ts reads repo-intel constants instead of going through the ' +
        'container.repoIntel facade.',
      severity: 'warn', // → error once repos/service.ts stops importing repo-intel
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
      },
    },
    {
      name: 'no-circular',
      comment:
        'A cycle means the layering is wrong somewhere in the loop. Outstanding: ' +
        'repo-intel service/pipelines cycle through the container, and agents ' +
        'helpers/repository cycle with each other.',
      severity: 'warn', // → error once the repo-intel and agents cycles are broken
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Dead module — either wire it up or delete it.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)tsconfig\\.json$', '(^|/)\\.[^/]+\\.(js|cjs|ts)$'],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Vendored shared contracts are the common vocabulary of every ring — they are
    // resolved through a tsconfig path alias and are not part of the layer graph.
    exclude: { path: '^src/vendor/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
