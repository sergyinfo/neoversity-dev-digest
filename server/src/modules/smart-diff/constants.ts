import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff — every threshold and pattern lives here, nothing inline.
 *
 * The classifier is DETERMINISTIC and path-only: it must produce the same answer
 * the moment a PR is imported, before any review has run and without a model
 * call. That constrains what a rule may look at — a path and its change counts,
 * never file contents.
 */

/**
 * Ordered, first-match-wins. Boilerplate is tested BEFORE wiring because the
 * two overlap on purpose: `package.json` is config-shaped (wiring by feel) but a
 * reviewer skims it, and `package-lock.json` must never be anything but
 * boilerplate. Anything matching nothing here is `core` — the safe default,
 * since mislabelling real logic as skimmable is the costly direction of error.
 */
export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  // Dependency lock files — the acceptance criterion names these explicitly.
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)go\.sum$/,
  // Manifests: reviewed as "what changed in the dep list", not read line by line.
  /(^|\/)package\.json$/,
  // Build output and vendored trees.
  /(^|\/)(dist|build|out|coverage|vendor|node_modules)\//,
  /(^|\/)\.next\//,
  // Generated or mechanical.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.generated\.[a-z]+$/,
  /(^|\/)[a-z0-9_.-]+_pb\.[a-z]+$/i,
  /(^|\/)migrations\/meta\//,
  // Binary-ish assets: a diff of these tells a reviewer nothing.
  /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|zip)$/i,
];

/**
 * Wiring — how the change is hooked into the app. Real code, but a reviewer
 * reads it for "is it connected correctly", not for business rules.
 */
export const WIRING_PATTERNS: readonly RegExp[] = [
  // Barrels / re-export files.
  /(^|\/)index\.(ts|tsx|js|jsx)$/,
  // App bootstrap.
  /(^|\/)(server|app|main|bootstrap)\.(ts|tsx|js|jsx)$/,
  // Configuration, in its many spellings.
  /(^|\/)config\.(ts|tsx|js|jsx|json|ya?ml)$/,
  /(^|\/)[a-z0-9_.-]+\.config\.[a-z]+$/i,
  /(^|\/)tsconfig(\.[a-z0-9-]+)?\.json$/,
  /(^|\/)\.env(\.[a-z0-9-]+)?(\.example)?$/,
  // Container + CI.
  /(^|\/)Dockerfile(\.[a-z0-9-]+)?$/,
  /(^|\/)docker-compose(\.[a-z0-9-]+)?\.ya?ml$/,
  /(^|\/)\.github\//,
  // DB migrations: the SQL itself is wiring; its meta/ snapshots are boilerplate
  // and are caught earlier by BOILERPLATE_PATTERNS.
  /(^|\/)migrations\//,
];

/**
 * Display order of the groups. Core first is the whole point of the feature —
 * a reviewer should meet business logic before a lock file.
 */
export const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * A PR changing more than this many lines is flagged `too_big` and offered a
 * split. Chosen to sit above a normal feature PR and below the "this is a
 * migration, of course it is huge" range; boilerplate lines are EXCLUDED from
 * the count (see service.ts) so a lock-file refresh alone never trips it.
 */
export const SPLIT_TOO_BIG_LINES = 400;

/** Below this many non-boilerplate files, splitting is not worth proposing. */
export const SPLIT_MIN_FILES = 4;

/**
 * How many leading path segments name a proposed split (`src/api/x.ts` →
 * `src/api` at 2). Splitting on the top segment alone lumps all of `src/`
 * together and proposes nothing useful.
 */
export const SPLIT_GROUP_DEPTH = 2;
