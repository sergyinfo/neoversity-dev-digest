import { describe, it, expect } from 'vitest';
import { splitDiffByFile } from '../src/modules/reviews/diff-review.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';

/**
 * C1 — splitting a raw `git diff HEAD` into `pr_files` rows.
 *
 * The round-trip is the real assertion. `diffFromPrFiles` re-adds the
 * `diff --git` / `---` / `+++` header lines itself, so a `patch` that still
 * carried them would produce a doubled header and the parser would read the
 * file as having no hunks — a review of nothing, reported as success. That is
 * precisely the empty-diff failure mode recorded in server/INSIGHTS.md, arriving
 * by a different road.
 */

const RAW = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,2 +10,2 @@ function f() {
-  return 1;
+  return 2;
`;

describe('splitDiffByFile', () => {
  it('returns one row per file with the b-side path', () => {
    const rows = splitDiffByFile(RAW);
    expect(rows.map((r) => r.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('stores HUNKS ONLY — no diff/---/+++ header lines', () => {
    const [a] = splitDiffByFile(RAW);
    expect(a!.patch.startsWith('@@ ')).toBe(true);
    expect(a!.patch).not.toContain('diff --git');
    expect(a!.patch).not.toContain('--- a/');
    expect(a!.patch).not.toContain('+++ b/');
    expect(a!.patch).toContain('+const z = 4;');
  });

  it('carries the parser’s own add/delete counts', () => {
    const [a, b] = splitDiffByFile(RAW);
    expect(a!.additions).toBe(2);
    expect(a!.deletions).toBe(1);
    expect(b!.additions).toBe(1);
    expect(b!.deletions).toBe(1);
  });

  it('skips a section with no hunks (rename or mode change only)', () => {
    const renameOnly = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`;
    expect(splitDiffByFile(renameOnly)).toEqual([]);
  });

  it('returns [] for an empty diff rather than a bogus row', () => {
    expect(splitDiffByFile('')).toEqual([]);
  });

  it('ROUND-TRIPS: rows → diffFromPrFiles → the same files and hunks', async () => {
    const rows = splitDiffByFile(RAW);
    const repo = {
      getPrFiles: async () => rows.map((r) => ({ path: r.path, patch: r.patch })),
    } as unknown as ReviewRepository;

    const rebuilt = await diffFromPrFiles(repo, 'pr-1');

    expect(rebuilt.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    // Non-empty hunks are the point: this is what the executor actually reviews.
    for (const f of rebuilt.files) expect(f.hunks.length).toBeGreaterThan(0);
    expect(rebuilt.files[0]!.additions).toBe(2);
  });
});
