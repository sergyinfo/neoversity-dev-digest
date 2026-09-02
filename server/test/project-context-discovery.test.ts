import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverDocs,
  isDiscoverableDocPath,
  isSafeRelPath,
  readDoc,
  resolveCloneRoot,
  safeDocPath,
  hasAllowedPrefix,
  hasAllowedSegment,
} from '../src/modules/project-context/discovery.js';
import {
  CONTEXT_DOC_DIR_SEGMENTS,
  MAX_LISTED_DOCS,
} from '../src/modules/project-context/constants.js';

/**
 * L05 (S5) — discovery and the containment gate.
 *
 * Everything here is built in a TEMP DIRECTORY rather than in a committed
 * fixture, for two reasons that both matter:
 *
 *  - AC-3's excluded-directory case needs a `node_modules/` path, and
 *    `node_modules/` is gitignored at `.gitignore:1` with no negation. A
 *    committed fixture for it cannot exist, and "fixing" that by adding a `!`
 *    negation would widen a repo-wide rule to serve one test.
 *  - the symlink-escape case needs a link OUT of the tree, which is not
 *    something to commit into a repository at all.
 */

const tokenizer = { count: (text: string) => Math.ceil(text.length / 4) };

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ctx-discovery-'));
  root = join(base, 'clone');
  outside = join(base, 'outside');

  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'server', 'docs'), { recursive: true });
  await mkdir(join(root, '.devdigest', 'specs'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg', 'docs'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(outside, { recursive: true });

  // Both roots are REALPATH'd, because that is what `resolveCloneRoot` hands
  // every caller and what `safeDocPath` compares against. On macOS `mkdtemp`
  // returns a path under `/var`, which is itself a symlink to `/private/var` —
  // a non-realpath'd root would refuse every legitimate document.
  root = await realpath(root);
  outside = await realpath(outside);

  await writeFile(join(root, 'docs', 'a.md'), '# A\n\nleading segment case.\n');
  await writeFile(
    join(root, 'server', 'docs', 'b.md'),
    '# B\n\nNON-leading segment: a prefix match would miss this one.\n',
  );
  await writeFile(join(root, '.devdigest', 'specs', 'prd.md'), '# PRD\n\nthe prefix case.\n');
  await writeFile(join(root, 'docs', 'notes.mdx'), '# MDX\n\nmdx counts too.\n');

  // Negatives.
  await writeFile(join(root, 'README.md'), '# readme — deliberately not discoverable');
  await writeFile(join(root, 'src', 'notes.md'), '# notes — not under a doc directory');
  await writeFile(join(root, 'node_modules', 'pkg', 'docs', 'x.md'), '# excluded directory');
  await writeFile(join(root, 'docs', 'diagram.png'), 'not markdown');

  // F1 — the payload the security review actually extracted. `git clone` writes
  // the tokenised remote URL into `.git/config` verbatim and nothing rewrites
  // it afterwards, so this is the real file, not a stand-in.
  await writeFile(
    join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://x-access-token:ghp_PLANTEDSECRET@github.com/a/b.git\n',
  );
  await writeFile(join(root, '.env'), 'OPENAI_API_KEY=sk-PLANTEDSECRET\n');

  // The escape this module exists to close: a directory symlink out of the
  // clone, under an allow-listed segment, with no `..`, nothing absolute and no
  // null byte. Every string check in the repo passes it.
  await writeFile(join(outside, 'passwd.md'), 'HOST SECRET — must never be read');
  await symlink(outside, join(root, 'docs', 'vendor-notes'), 'dir');
  await symlink(join(outside, 'passwd.md'), join(root, 'docs', 'leak.md'), 'file');
});

afterAll(async () => {
  if (root) await rm(join(root, '..'), { recursive: true, force: true });
});

describe('discovery walk', () => {
  it('AC-1 — lists documents with path, size and modified time', async () => {
    const { files, capped } = await discoverDocs(root, tokenizer);
    const paths = files.map((f) => f.path);

    expect(paths).toContain('docs/a.md');
    expect(paths).toContain('server/docs/b.md');
    expect(capped).toBe(false);

    const a = files.find((f) => f.path === 'docs/a.md')!;
    expect(a.size).toBeGreaterThan(0);
    expect(typeof a.updated_at).toBe('string');
    expect(Number.isNaN(Date.parse(a.updated_at!))).toBe(false);
  });

  it('AC-3 — root README, a non-doc directory and an excluded directory are all absent', async () => {
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('src/notes.md');
    expect(paths).not.toContain('node_modules/pkg/docs/x.md');
    // and nothing that merely happens to live under node_modules
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
  });

  it('AC-4 — `.devdigest/specs/prd.md` is discovered', async () => {
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).toContain('.devdigest/specs/prd.md');
  });

  /**
   * F2 — the prefix predicate, IN ISOLATION.
   *
   * Without stubbing the segment list this assertion proves nothing:
   * `REFERENCE_DOC_DIRS` contains `specs`, so `.devdigest/specs/prd.md` matches
   * on its own `specs` segment and AC-4 passes whether or not the prefix branch
   * exists at all. That is exactly how the entry stayed inert. With `specs`
   * removed from the segment list, this test fails the moment the prefix branch
   * is deleted — regardless of what another module's list happens to contain.
   */
  it('F2 — the prefix predicate works with `specs` removed from the segment list', async () => {
    const withoutSpecs = CONTEXT_DOC_DIR_SEGMENTS.filter((d) => d !== 'specs' && d !== 'spec');
    expect(withoutSpecs).not.toContain('specs');

    const { files } = await discoverDocs(root, tokenizer, { dirSegments: withoutSpecs });
    const paths = files.map((f) => f.path);

    expect(paths).toContain('.devdigest/specs/prd.md');
    // Control: with BOTH predicates disabled it disappears, proving the prefix
    // branch — not some third path — is what kept it.
    const { files: none } = await discoverDocs(root, tokenizer, {
      dirSegments: withoutSpecs,
      pathPrefixes: [],
    });
    expect(none.map((f) => f.path)).not.toContain('.devdigest/specs/prd.md');
  });

  it('D-2a — a NON-LEADING allow-listed segment is discovered, where a prefix match would miss it', async () => {
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).toContain('server/docs/b.md');
    // The precedent this deliberately widens: `isSafeRepoPath` prefix-matches.
    expect(hasAllowedSegment('server/docs/b.md', CONTEXT_DOC_DIR_SEGMENTS)).toBe(true);
    expect(
      CONTEXT_DOC_DIR_SEGMENTS.some((d) => 'server/docs/b.md'.startsWith(`${d}/`)),
    ).toBe(false);
  });

  it('matches .md and .mdx only', async () => {
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).toContain('docs/notes.mdx');
    expect(paths).not.toContain('docs/diagram.png');
  });

  it('AC-7 — a positive integer estimate, stable across repeat calls', async () => {
    const first = await discoverDocs(root, tokenizer);
    const second = await discoverDocs(root, tokenizer);

    const a = first.files.find((f) => f.path === 'docs/a.md')!;
    expect(a.tokens_estimate).toBeGreaterThan(0);
    expect(Number.isInteger(a.tokens_estimate)).toBe(true);

    expect(second.files.map((f) => [f.path, f.tokens_estimate])).toEqual(
      first.files.map((f) => [f.path, f.tokens_estimate]),
    );
  });

  it('caps the listing at MAX_LISTED_DOCS and says so (NFR-1)', async () => {
    const many = join(root, 'docs', 'many');
    await mkdir(many, { recursive: true });
    await Promise.all(
      Array.from({ length: MAX_LISTED_DOCS + 5 }, (_, i) =>
        writeFile(join(many, `doc-${String(i).padStart(4, '0')}.md`), `# ${i}\n`),
      ),
    );

    const { files, capped } = await discoverDocs(root, tokenizer);
    expect(capped).toBe(true);
    expect(files).toHaveLength(MAX_LISTED_DOCS);
    // A PREFIX of what is on disk in a stable, sorted order — so "the first N
    // when capped" is reproducible rather than whatever readdir happened to
    // return. The UI says the list is capped; it must not imply it is complete.
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths[0]).toBe('.devdigest/specs/prd.md');

    await rm(many, { recursive: true, force: true });
  });

  it('tolerates an unreadable directory rather than failing the whole walk', async () => {
    // A dangling symlink under an allow-listed directory: `readdir` on it fails
    // and the walk keeps going, the way `walk.ts:79-86` does.
    const dangling = join(root, 'docs', 'gone');
    await symlink(join(outside, 'does-not-exist'), dangling, 'dir');
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).toContain('docs/a.md');
    await rm(dangling, { force: true });
  });
});

describe('containment gate', () => {
  it('AC-5 — refuses traversal, absolute, Windows-absolute and null-byte paths', () => {
    for (const bad of [
      '../../../etc/passwd',
      'docs/../../etc/passwd',
      '/etc/passwd',
      '\\etc\\passwd',
      'C:\\Windows\\win.ini',
      'docs/a\0.md',
      '',
      '   ',
    ]) {
      expect(isSafeRelPath(bad)).toBe(false);
    }
    expect(isSafeRelPath('docs/a.md')).toBe(true);
    expect(isSafeRelPath('.devdigest/specs/prd.md')).toBe(true);
  });

  /**
   * Fix-brief F11. `isSafeRelPath` is the ONE gate a user-supplied path passes
   * through untouched — it reaches `runLog.info(\`project context: skipped
   * ${'${s.path}'} — ...\`)` and `RunTrace.specs_read` verbatim. A `\n` or `\r`
   * in it forges an extra line in anything that reads those back as text.
   *
   * The structural defences hold today (`RunLogger.logFor` stores objects and
   * the client renders through React), which is exactly why this is asserted
   * here rather than left to them: the validation is the layer that is supposed
   * to make the question moot.
   */
  it('F11 — refuses control characters, not merely NUL', () => {
    for (const bad of [
      'docs/a\nFAKE.md',
      'docs/a\rFAKE.md',
      'docs/a\tb.md',
      'docs/a\u0007b.md',
      'docs/a\u001bb.md',
      'docs/a\u007fb.md',
      'docs/a\0.md',
    ]) {
      expect(isSafeRelPath(bad)).toBe(false);
    }
    // Ordinary paths, including the one property a control-char rule must not
    // over-reach into: spaces are legal in filenames (see F8).
    expect(isSafeRelPath('docs/my notes.md')).toBe(true);
  });

  it('AC-5 — a refused path is never opened', async () => {
    for (const bad of ['../../../etc/passwd', '/etc/passwd', 'docs/a\0.md', 'docs/a\nFAKE.md']) {
      expect(await safeDocPath(root, bad)).toBeNull();
      const read = await readDoc(root, bad);
      expect(read.ok).toBe(false);
    }
  });

  /**
   * The case that motivates this module. `docs/vendor-notes -> <outside>` gives
   * `docs/vendor-notes/passwd.md`: no `..`, not absolute, no null byte, under an
   * allow-listed segment. It passes every string check in this repository, and
   * `GitClient.readFile`'s bare `join` would open it.
   */
  it('a symlinked directory out of the clone yields nothing and reads nothing', async () => {
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).not.toContain('docs/vendor-notes/passwd.md');
    expect(paths.some((p) => p.startsWith('docs/vendor-notes'))).toBe(false);

    // The string checks agree it is fine — which is the whole point.
    expect(isSafeRelPath('docs/vendor-notes/passwd.md')).toBe(true);
    expect(hasAllowedSegment('docs/vendor-notes/passwd.md', CONTEXT_DOC_DIR_SEGMENTS)).toBe(true);

    // The containment check is what refuses it.
    expect(await safeDocPath(root, 'docs/vendor-notes/passwd.md')).toBeNull();
    const read = await readDoc(root, 'docs/vendor-notes/passwd.md');
    expect(read.ok).toBe(false);
    expect(JSON.stringify(read)).not.toContain('HOST SECRET');
  });

  it('a symlinked FILE out of the clone is refused at the read gate too', async () => {
    expect(await safeDocPath(root, 'docs/leak.md')).toBeNull();
    const read = await readDoc(root, 'docs/leak.md');
    expect(read.ok).toBe(false);
    // ...and it is not listed either, because the walk skips symlinks outright.
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    expect(paths).not.toContain('docs/leak.md');
  });

  it('a legitimate document resolves to a path inside the clone', async () => {
    const abs = await safeDocPath(root, 'docs/a.md');
    expect(abs).not.toBeNull();
    expect(abs!.startsWith(root)).toBe(true);
    const read = await readDoc(root, 'docs/a.md');
    expect(read.ok && read.content).toContain('leading segment case');
  });

  it('classifies over-cap, empty and missing documents without throwing', async () => {
    await writeFile(join(root, 'docs', 'big.md'), 'x'.repeat(64 * 1024 + 1));
    await writeFile(join(root, 'docs', 'blank.md'), '   \n\n  ');

    expect(await readDoc(root, 'docs/big.md')).toEqual({ ok: false, reason: 'over_cap' });
    expect(await readDoc(root, 'docs/blank.md')).toEqual({ ok: false, reason: 'empty' });
    expect(await readDoc(root, 'docs/never-existed.md')).toEqual({
      ok: false,
      reason: 'unsafe_path',
    });

    // AC-6's listing half: over-cap is LISTED and MARKED, not dropped, and
    // carries no estimate — a number nobody may act on is not worth a 64 KB read.
    const big = (await discoverDocs(root, tokenizer)).files.find((f) => f.path === 'docs/big.md')!;
    expect(big.over_cap).toBe(true);
    expect(big.tokens_estimate).toBeUndefined();

    await rm(join(root, 'docs', 'big.md'), { force: true });
    await rm(join(root, 'docs', 'blank.md'), { force: true });
  });
});

/**
 * Fix-brief F1 — the read gate must enforce the ALLOW-LIST, not only
 * containment.
 *
 * Before this fix the `.md`/`.mdx` filter, the doc-directory allow-list and the
 * `EXCLUDED_DIRS` skip lived only inside `walkDir`, so `readDoc` happily
 * returned `.git/config` — which carries the PAT `withGitHubToken` embeds in
 * the clone URL — straight into a model prompt and a persisted trace. The walk
 * listing none of these files was never the guarantee; it was the only place
 * the rule was applied.
 */
describe('F1 — a path the walk would not list is not readable either', () => {
  const refused = [
    '.git/config',
    '.env',
    'README.md',
    'src/notes.md',
    'node_modules/pkg/docs/x.md',
    'docs/diagram.png',
  ];

  it('the walk lists none of them', async () => {
    const paths = (await discoverDocs(root, tokenizer)).files.map((f) => f.path);
    for (const rel of refused) expect(paths).not.toContain(rel);
  });

  it('...and the READ gate refuses every one, so a pre-fix attachment is unreadable', async () => {
    for (const rel of refused) {
      expect(isDiscoverableDocPath(rel)).toBe(false);
      expect(await safeDocPath(root, rel)).toBeNull();
      const read = await readDoc(root, rel);
      expect(read).toEqual({ ok: false, reason: 'unsafe_path' });
    }
  });

  it('no refused read can leak the secret it was pointed at', async () => {
    // The two that actually hold one on disk. `JSON.stringify` of the whole
    // result, so a leak through any field — content, a reason, a path echo —
    // fails this rather than only the shape we happened to assert above.
    for (const rel of ['.git/config', '.env']) {
      expect(JSON.stringify(await readDoc(root, rel))).not.toContain('PLANTEDSECRET');
    }
  });

  it('the containment escape and the allow-list are INDEPENDENT gates', async () => {
    // `.git/config` is perfectly contained — `realpath` resolves it inside the
    // clone — so containment alone can never refuse it. That is why F1 was
    // invisible to the traversal tests above, which all still pass.
    expect(isSafeRelPath('.git/config')).toBe(true);
    expect(await realpath(join(root, '.git', 'config'))).toContain(root);

    // ...and conversely a doc that IS allow-listed but escapes is still refused
    // by containment (the existing symlink cases, restated as one assertion so
    // deleting either gate fails a test).
    expect(isDiscoverableDocPath('docs/vendor-notes/passwd.md')).toBe(true);
    expect(await safeDocPath(root, 'docs/vendor-notes/passwd.md')).toBeNull();
  });

  it('a legitimate document is unaffected by the new gate', async () => {
    for (const rel of ['docs/a.md', 'server/docs/b.md', '.devdigest/specs/prd.md', 'docs/notes.mdx']) {
      expect(isDiscoverableDocPath(rel)).toBe(true);
      expect(await safeDocPath(root, rel)).not.toBeNull();
    }
  });
});

describe('resolveCloneRoot — three outcomes, and none of them a 500 (F3)', () => {
  it('a null clone_path is `not_cloned`', async () => {
    expect(await resolveCloneRoot(null)).toEqual({ ok: false, reason: 'not_cloned' });
    expect(await resolveCloneRoot(undefined)).toEqual({ ok: false, reason: 'not_cloned' });
    expect(await resolveCloneRoot('')).toEqual({ ok: false, reason: 'not_cloned' });
  });

  it('a clone_path pointing at a deleted directory is `clone_missing`, and never throws', async () => {
    const gone = join(root, '..', 'deleted-clone');
    await expect(resolveCloneRoot(gone)).resolves.toEqual({
      ok: false,
      reason: 'clone_missing',
    });
  });

  it('an existing clone resolves to a real path', async () => {
    const resolved = await resolveCloneRoot(root);
    expect(resolved.ok).toBe(true);
    // Real, not merely absolute: on macOS `/var` is itself a symlink, and a
    // non-realpath'd root would reject every document under it.
    expect(resolved.ok && resolved.root).not.toContain('/../');
  });
});

describe('the two predicates are genuinely different functions', () => {
  it('a two-segment string can never match a per-segment comparison (F2)', () => {
    expect(hasAllowedSegment('.devdigest/specs/prd.md', ['.devdigest/specs'])).toBe(false);
    expect(hasAllowedPrefix('.devdigest/specs/prd.md', ['.devdigest/specs/'])).toBe(true);
  });

  it('the prefix is anchored, so a sibling name does not match', () => {
    expect(hasAllowedPrefix('.devdigest/specsomething.md', ['.devdigest/specs/'])).toBe(false);
  });
});
