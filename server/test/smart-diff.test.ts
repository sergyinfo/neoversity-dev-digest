import { describe, it, expect } from 'vitest';
import { classifyPath, compareByRisk } from '../src/modules/smart-diff/classify.js';
import { ROLE_ORDER, SPLIT_TOO_BIG_LINES } from '../src/modules/smart-diff/constants.js';

describe('classifyPath — boilerplate', () => {
  /** The acceptance criterion names lock files specifically. */
  it.each([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'Cargo.lock',
    'poetry.lock',
    'Gemfile.lock',
    'composer.lock',
    'go.sum',
  ])('always classifies %s as boilerplate', (name) => {
    expect(classifyPath(name)).toBe('boilerplate');
    expect(classifyPath(`nested/deep/${name}`)).toBe('boilerplate');
    expect(classifyPath(`./${name}`)).toBe('boilerplate');
    expect(classifyPath(`nested\\deep\\${name}`)).toBe('boilerplate');
  });

  it.each([
    'package.json',
    'dist/bundle.js',
    'build/main.css',
    'coverage/lcov.info',
    'client/.next/static/chunk.js',
    'src/__snapshots__/App.test.tsx.snap',
    'test/App.test.tsx.snap',
    'public/app.min.js',
    'src/api.generated.ts',
    'proto/user_pb.js',
    'server/src/db/migrations/meta/0012_snapshot.json',
    'assets/logo.svg',
    'assets/hero.PNG',
    'fonts/Inter.woff2',
  ])('classifies %s as boilerplate', (path) => {
    expect(classifyPath(path)).toBe('boilerplate');
  });
});

describe('classifyPath — wiring', () => {
  it.each([
    'src/api/public/index.ts',
    'src/server.ts',
    'src/app.tsx',
    'src/main.js',
    'src/config.ts',
    'vitest.config.ts',
    'next.config.mjs',
    'tsconfig.json',
    'tsconfig.build.json',
    '.env',
    '.env.example',
    '.env.production',
    'Dockerfile',
    'docker-compose.yml',
    '.github/workflows/ci.yml',
    'server/src/db/migrations/0012_tidy.sql',
  ])('classifies %s as wiring', (path) => {
    expect(classifyPath(path)).toBe('wiring');
  });
});

describe('classifyPath — core is the fallback', () => {
  it.each([
    'src/middleware/ratelimit.ts',
    'src/api/public/webhooks.ts',
    'src/api/users.ts',
    'src/domain/pricing.rb',
    'lib/billing/invoice.go',
    'README.md',
  ])('classifies %s as core', (path) => {
    expect(classifyPath(path)).toBe('core');
  });

  it('prefers boilerplate over wiring where the two overlap', () => {
    // package.json is config-shaped, so the wiring rules would happily take it;
    // boilerplate is tested first precisely so a reviewer skims it.
    expect(classifyPath('package.json')).toBe('boilerplate');
    // …and a migrations SNAPSHOT is boilerplate even though migrations/ is wiring.
    expect(classifyPath('db/migrations/meta/0001_snapshot.json')).toBe('boilerplate');
    expect(classifyPath('db/migrations/0001_init.sql')).toBe('wiring');
  });

  it('an unrecognised path is core, never dropped', () => {
    expect(classifyPath('some/unheard/of/thing.xyz')).toBe('core');
  });
});

describe('compareByRisk', () => {
  const f = (path: string, additions: number, deletions: number, finding_lines: number[]) => ({
    path,
    additions,
    deletions,
    finding_lines,
  });

  it('puts files with more findings first', () => {
    const sorted = [f('a.ts', 500, 0, []), f('b.ts', 1, 0, [1, 2])].sort(compareByRisk);
    expect(sorted.map((x) => x.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('falls back to change size when findings tie', () => {
    const sorted = [f('a.ts', 1, 0, [1]), f('b.ts', 40, 10, [2])].sort(compareByRisk);
    expect(sorted.map((x) => x.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('is stable on a full tie, so the list does not reshuffle between requests', () => {
    const input = [f('z.ts', 5, 5, []), f('a.ts', 5, 5, []), f('m.ts', 5, 5, [])];
    const once = [...input].sort(compareByRisk).map((x) => x.path);
    const twice = [...input].reverse().sort(compareByRisk).map((x) => x.path);
    expect(once).toEqual(['a.ts', 'm.ts', 'z.ts']);
    expect(twice).toEqual(once);
  });
});

describe('constants', () => {
  it('orders the groups core → wiring → boilerplate', () => {
    expect([...ROLE_ORDER]).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('keeps the split threshold configurable rather than inline', () => {
    expect(typeof SPLIT_TOO_BIG_LINES).toBe('number');
    expect(SPLIT_TOO_BIG_LINES).toBeGreaterThan(0);
  });
});
