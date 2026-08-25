import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
  resolve: {
    alias: {
      // Mirrors tsconfig `paths`. Defensive only: every `@devdigest/shared`
      // import in this package is `import type` and erases at build time.
      '@devdigest/shared': fileURLToPath(
        new URL('../server/src/vendor/shared/index.ts', import.meta.url),
      ),
    },
  },
});
