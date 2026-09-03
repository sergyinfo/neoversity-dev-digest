import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import { loadConfig } from '../src/platform/config.js';
import { RetroLedger } from '../src/modules/retro/contract.js';
import { LEDGER_REL_PATH, readLedger } from '../src/modules/retro/ledger.js';

/**
 * The retro ledger viewer (`GET /retro/ledger`).
 *
 * No DB: the handler reads one file off disk, so this belongs in the
 * no-Docker suite next to `routes-smoke.test.ts` rather than in an
 * `.it.test.ts`.
 *
 * Two things are worth pinning down and nothing else is:
 *  1. the route really returns THIS repo's `docs/retro/ledger.md` — the path
 *     walk is the one part of this feature that can silently be wrong, and it
 *     would be wrong in a way that still returns a valid 200 (`exists: false`),
 *     i.e. indistinguishable from "nobody has run /retro yet";
 *  2. an absent file is a clean empty outcome. That is a NORMAL state in a
 *     fresh checkout, and it must never surface as a 500.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The ledger, located independently of the module under test. */
const LEDGER_ABS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  ...LEDGER_REL_PATH.split('/'),
);

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:fs/promises');
});

/**
 * `/retro/ledger` reads a committed FILE, but its handler still resolves tenancy
 * through `getContext` → `LocalNoAuthProvider`, which QUERIES THE DATABASE. Built
 * with only `{ config }`, this suite therefore opened a real connection: on a dev
 * machine that silently succeeded against whatever Postgres happened to be up, and
 * in CI — where the unit job runs without a database — every request hung for the 5s
 * connect timeout and returned 500. A test in the DB-free suite must not need a DB.
 */
function emptyDb(): Db {
  const chain: unknown = new Proxy(function noop() {} as object, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
      return () => chain;
    },
    apply: () => chain,
  });
  return chain as Db;
}

const auth = {
  currentUser: async () => ({ id: 'user-1', email: 'a@b.c', name: 'Test' }),
  currentWorkspace: async () => ({ id: '22222222-2222-4222-8222-222222222222', name: 'default' }),
};

describe('GET /retro/ledger', () => {
  it('is registered', async () => {
    const app = await buildApp({ config, db: emptyDb(), overrides: { auth } });
    expect(app.hasRoute({ method: 'GET', url: '/retro/ledger' })).toBe(true);
    await app.close();
  });

  it("returns the committed ledger's content and its last-modified time", async () => {
    const [expectedContent, expectedStat] = await Promise.all([
      readFile(LEDGER_ABS, 'utf8'),
      stat(LEDGER_ABS),
    ]);

    const app = await buildApp({ config, db: emptyDb(), overrides: { auth } });
    const res = await app.inject({ method: 'GET', url: '/retro/ledger' });
    await app.close();

    expect(res.statusCode).toBe(200);

    // Parsed against the module-local contract: nothing validates a response on
    // the way out in this server, so the schema is only worth what this is.
    const body = RetroLedger.parse(res.json());

    expect(body.exists).toBe(true);
    expect(body.path).toBe('docs/retro/ledger.md');
    // Byte-for-byte, not a substring: the point of the viewer is the file
    // verbatim, and a truncating bug would still pass a `toContain`.
    expect(body.content).toBe(expectedContent);
    expect(body.updated_at).toBe(expectedStat.mtime.toISOString());

    // The path walk really landed on THIS file, rather than on some other
    // `docs/retro/ledger.md` further up the filesystem.
    expect(body.content).toContain('# Retro ledger');
  });

  /**
   * The empty state is the state anyone will actually see today: the ledger
   * carries a header, a scope note and the entries marker, and zero entries.
   * The route must serve that as ordinary content, not as "no data".
   */
  it('serves the entries marker, so the client can tell an empty ledger from a full one', async () => {
    const app = await buildApp({ config, db: emptyDb(), overrides: { auth } });
    const res = await app.inject({ method: 'GET', url: '/retro/ledger' });
    await app.close();

    expect(res.json().content).toContain('<!-- entries below, newest first -->');
  });

  it('takes no path input at all — a query string cannot redirect the read', async () => {
    const app = await buildApp({ config, db: emptyDb(), overrides: { auth } });
    const clean = await app.inject({ method: 'GET', url: '/retro/ledger' });
    const attempt = await app.inject({
      method: 'GET',
      url: '/retro/ledger?path=../../../../etc/passwd',
    });
    await app.close();

    // The query string is not a schema violation — it is simply not read.
    // Identical bodies is the assertion: there is no input to exploit.
    expect(attempt.statusCode).toBe(200);
    expect(attempt.json()).toEqual(clean.json());
    expect(attempt.json().path).toBe('docs/retro/ledger.md');
  });
});

describe('readLedger — the file is absent', () => {
  /**
   * `vi.doMock` (not `vi.mock`) so the mock is scoped to the dynamic import
   * below and the rest of this file still reads the real disk. The stub is
   * PATH-AWARE — only the ledger raises ENOENT — so nothing else in the module
   * graph is affected by a blanket fs failure.
   */
  async function withMissingLedger<T>(fn: (m: typeof import('../src/modules/retro/ledger.js')) => Promise<T>) {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (orig) => {
      const actual = await orig<typeof import('node:fs/promises')>();
      const enoent = (p: unknown) => {
        if (typeof p === 'string' && p.endsWith('docs/retro/ledger.md')) {
          const e = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
          e.code = 'ENOENT';
          throw e;
        }
        return null;
      };
      return {
        ...actual,
        default: actual,
        readFile: (p: unknown, ...rest: unknown[]) =>
          enoent(p) ?? (actual.readFile as (...a: unknown[]) => unknown)(p, ...rest),
        stat: (p: unknown, ...rest: unknown[]) =>
          enoent(p) ?? (actual.stat as (...a: unknown[]) => unknown)(p, ...rest),
      };
    });
    return fn(await import('../src/modules/retro/ledger.js'));
  }

  it('resolves to a clean empty outcome instead of throwing', async () => {
    const out = await withMissingLedger(async (m) => m.readLedger());

    // Clean: parses as the same envelope a present file produces, so the
    // client needs no second shape for "not written yet".
    const body = RetroLedger.parse(out);
    expect(body).toEqual({
      content: '',
      updated_at: null,
      exists: false,
      path: 'docs/retro/ledger.md',
    });
  });

  it('a genuine fs fault is NOT swallowed as "absent"', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (orig) => {
      const actual = await orig<typeof import('node:fs/promises')>();
      const eacces = () => {
        const e = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        e.code = 'EACCES';
        throw e;
      };
      return { ...actual, default: actual, readFile: eacces, stat: eacces };
    });
    const { readLedger: readMocked } = await import('../src/modules/retro/ledger.js');

    // Absence is normal and is reported as data; a permissions fault is a real
    // fault and must keep propagating rather than masquerading as an empty
    // ledger the user is then told to go write.
    await expect(readMocked()).rejects.toThrow(/EACCES/);
  });
});

describe('readLedger — against the real repo', () => {
  it('reads the same bytes the file holds', async () => {
    const out = await readLedger();
    expect(out.exists).toBe(true);
    expect(out.content).toBe(await readFile(LEDGER_ABS, 'utf8'));
  });
});
