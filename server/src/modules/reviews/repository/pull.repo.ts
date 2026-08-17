import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

export async function getPrCommits(
  db: Db,
  prId: string,
): Promise<(typeof t.prCommits.$inferSelect)[]> {
  return db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/** Derivation provenance stored alongside the intent itself. */
export interface IntentProvenance {
  headSha?: string | null;
  model?: string | null;
}

export async function upsertIntent(
  db: Db,
  prId: string,
  intent: Intent,
  provenance: IntentProvenance = {},
): Promise<void> {
  const values = {
    prId,
    intent: intent.intent,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    // The column is NOT NULL with a 'low' default; a writer that omits the band
    // must land on the cautious end rather than inheriting the previous row's.
    confidence: intent.confidence ?? ('low' as const),
    sources: intent.sources ?? [],
    headSha: provenance.headSha ?? null,
    model: provenance.model ?? null,
    // Re-derivation must refresh the age shown in the UI; the column default
    // only applies on INSERT.
    derivedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent: values.intent,
        inScope: values.inScope,
        outOfScope: values.outOfScope,
        confidence: values.confidence,
        sources: values.sources,
        headSha: values.headSha,
        model: values.model,
        derivedAt: values.derivedAt,
      },
    });
}

/** The stored intent plus its provenance, or undefined when never derived. */
export async function getIntent(
  db: Db,
  prId: string,
): Promise<(Intent & IntentProvenance & { derivedAt: Date }) | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources as Intent['sources'],
    headSha: row.headSha,
    model: row.model,
    derivedAt: row.derivedAt,
  };
}
