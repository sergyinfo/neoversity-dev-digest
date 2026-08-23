/**
 * Blast-domain predicates.
 */

/**
 * Paths that are NOT an HTTP surface, even when the indexer found route-shaped
 * strings in them.
 *
 * `extractEndpoints` matches `app|router|fastify|server|api . get|post|…('…')`,
 * which is right for a route registration and wrong for a test that *calls* one:
 * `api.get(\`/agents/${id}/versions\`)` in a spec looks identical to the matcher.
 * Observed on this repository — `MockLLMProvider` came back "affecting" 20 HTTP
 * endpoints purely because `routes-smoke.test.ts` exercises them.
 *
 * A test consumes endpoints; it does not serve them. Attributing them to a
 * changed symbol tells a reviewer the change is riskier than it is, and a
 * hand-verification of the map (which the acceptance criteria require) would
 * immediately show the claim to be false.
 *
 * This filter applies to ENDPOINT and CRON attribution only. Callers are left
 * alone on purpose: a test really does call the symbol, and hiding that would
 * understate the map.
 */
const NON_HTTP_PATH_PATTERNS = [
  '.test.',
  '.spec.',
  '.d.ts',
  '__tests__/',
  '__mocks__/',
  '/test/',
  '/tests/',
  '/__fixtures__/',
  '/e2e/',
  '.config.',
  'vitest.',
  'jest.',
];

export function isHttpSurface(path: string): boolean {
  const lower = path.toLowerCase();
  return !NON_HTTP_PATH_PATTERNS.some((p) => lower.includes(p));
}
