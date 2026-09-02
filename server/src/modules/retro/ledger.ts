import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RetroLedger } from './contract.js';

/**
 * Locating a repo-root file at runtime. The precedent is `db/migrate.ts:9-10`
 * (`dirname(fileURLToPath(import.meta.url))` then `join`), but the assumption
 * that usually comes with it does NOT hold in this package, so this is a
 * bounded upward search rather than a fixed hop count.
 *
 * VERIFIED, 2026-08-29: `dist/` does NOT mirror `src/` here. `tsconfig.json`
 * sets no `rootDir`, and the `@devdigest/reviewer-core` path alias pulls
 * `../reviewer-core/src` into the program, so tsc infers the common root as the
 * REPO root and `pnpm build` emits `dist/server/src/modules/retro/ledger.js`
 * plus `dist/reviewer-core/src/...` — one segment deeper, and under an extra
 * `server/` besides. (Reproduce with
 * `pnpm exec tsc -p tsconfig.json --outDir <tmp> --listEmittedFiles`.) The same
 * fact already breaks `package.json`'s `start` script, which points at
 * `dist/server.js`; that is pre-existing and out of scope here. A fixed
 * four-level walk would therefore be correct under tsx and vitest — the only
 * ways this server currently runs — and quietly wrong the day the build is
 * fixed, resolving to a plausible directory and reporting the ledger as absent
 * rather than failing loudly.
 *
 * So: walk up from this module to the first directory that looks like the repo
 * root, and keep the nominal four-level hop only as a last-resort fallback.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** `<repo>/server/src/modules/retro` — four segments below the repo root. */
const NOMINAL_ROOT = join(HERE, '..', '..', '..', '..');

/** Give up rather than walk to `/` if this module is ever relocated. */
const MAX_WALK_UP = 8;

/**
 * Two markers, not one: `docs/` alone is common enough to hit by accident, and
 * `server/package.json` alone would match if this package were ever vendored
 * inside another checkout. Both together identify this repo's root.
 */
function looksLikeRepoRoot(dir: string): boolean {
  return existsSync(join(dir, 'server', 'package.json')) && existsSync(join(dir, 'docs'));
}

function resolveRepoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < MAX_WALK_UP; i++) {
    if (looksLikeRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return NOMINAL_ROOT;
}

const REPO_ROOT = resolveRepoRoot();

/** The ledger's location, relative to the repo root. Echoed to the client for display. */
export const LEDGER_REL_PATH = 'docs/retro/ledger.md';

/**
 * THE SECURITY POSTURE OF THIS FEATURE IS THAT THERE IS NO INPUT.
 *
 * The path is fixed and hard-coded here. The route accepts no path parameter,
 * no query string and no body — there is nothing a caller can say that changes
 * which file is opened, so there is no traversal surface to guard and no
 * containment check to get wrong.
 *
 * DO NOT make this generic. The moment a caller can choose the file, this
 * reintroduces exactly the symlink-escape class that `project-context`'s
 * `safeDocPath()` needed a `realpath()` gate to close
 * (`modules/project-context/discovery.ts:20-47`, and `server/INSIGHTS.md`
 * 2026-08-29 for why every string-only check on that path passes while an
 * arbitrary host file gets read). A "just let it take a filename" change here
 * is a security change, not a convenience one.
 */
const LEDGER_ABS_PATH = join(REPO_ROOT, ...LEDGER_REL_PATH.split('/'));

/** ENOENT/ENOTDIR — the file (or a directory on its way) is not there. */
function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Read the retro ledger.
 *
 * A missing file is a NORMAL outcome, not an error: this is a repo checkout
 * where nobody may have typed `/retro` yet. It comes back as
 * `{ exists: false, content: '', updated_at: null }` and a 200, never a 500.
 * Any other failure (a permissions problem, say) still propagates — that one is
 * a real fault and should be reported as one.
 */
export async function readLedger(): Promise<RetroLedger> {
  try {
    const [content, info] = await Promise.all([
      readFile(LEDGER_ABS_PATH, 'utf8'),
      stat(LEDGER_ABS_PATH),
    ]);
    return {
      content,
      updated_at: info.mtime.toISOString(),
      exists: true,
      path: LEDGER_REL_PATH,
    };
  } catch (e) {
    if (!isMissing(e)) throw e;
    return { content: '', updated_at: null, exists: false, path: LEDGER_REL_PATH };
  }
}
