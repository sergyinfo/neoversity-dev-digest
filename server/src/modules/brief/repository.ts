/**
 * L05 — data access for `pr_brief`. The ONLY layer in this module that touches
 * the database.
 *
 * TENANCY, STATED ONCE BECAUSE IT IS NOT VISIBLE IN THE SIGNATURES:
 * `pr_brief` carries **no `workspace_id`**. It scopes transitively through
 * `pr_id`, exactly as `pr_intent`, `pr_files` and `pr_commits` do. Both methods
 * here therefore take an **already-scoped** `prId` — one the caller obtained
 * from `reviewRepo.getPull(workspaceId, prId)` — and neither performs a
 * workspace-less lookup of its own that could be mistaken for a scoped one.
 *
 * This is the same hazard `server/INSIGHTS.md` records for the intent cache: a
 * cache HIT that skipped the ownership check would serve another tenant's brief
 * while a MISS correctly 404'd, making the guard depend on whether a row
 * happened to exist. The guard lives in `service.ts`, before either call below.
 *
 * CONCURRENCY (spec §6): the upsert is LAST WRITE WINS. Two tabs pressing
 * regenerate at once cost two model calls and leave the second answer stored;
 * neither is more correct than the other, and a row-level lock would buy
 * nothing but a queue.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** One `pr_brief` row, as stored. Parsing the JSON columns is the caller's job. */
export interface StoredBriefRow {
  prId: string;
  /** The grounded `BriefDocument`. Validated by the caller, never here. */
  json: unknown;
  /** `serializeFingerprint`'s output, or null for a row written before L05. */
  stateFingerprint: string | null;
  /** A `BriefProvenance`, or null for a row written before L05. */
  provenance: unknown;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  generatedAt: Date | null;
}

/**
 * Everything one assembly produced.
 *
 * `fingerprint` is the SERIALISED form (`serializeFingerprint`), not the
 * `BriefFingerprint` pair: the column stores the local component record
 * alongside the two digests so REQ-14 can name which input moved, and taking
 * the pair here would silently drop it.
 */
export interface BriefUpsert {
  document: unknown;
  fingerprint: string;
  provenance: unknown;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  generatedAt: Date;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /** The stored brief for an already-scoped PR, or null. */
  async getBrief(prId: string): Promise<StoredBriefRow | null> {
    const [row] = await this.db
      .select({
        prId: t.prBrief.prId,
        json: t.prBrief.json,
        stateFingerprint: t.prBrief.stateFingerprint,
        provenance: t.prBrief.provenance,
        model: t.prBrief.model,
        costUsd: t.prBrief.costUsd,
        tokensIn: t.prBrief.tokensIn,
        tokensOut: t.prBrief.tokensOut,
        generatedAt: t.prBrief.generatedAt,
      })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Store an assembly's result, replacing any previous one for this PR.
   *
   * `pr_id` is the primary key, so the conflict target is the key itself and
   * every non-key column is overwritten — a brief is replaced whole or not at
   * all. Merging halves of two assemblies would produce a document whose
   * provenance describes a different input than the one that produced it.
   */
  async upsertBrief(prId: string, values: BriefUpsert): Promise<void> {
    const row = {
      prId,
      json: values.document,
      stateFingerprint: values.fingerprint,
      provenance: values.provenance,
      model: values.model,
      costUsd: values.costUsd,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      generatedAt: values.generatedAt,
    };
    await this.db
      .insert(t.prBrief)
      .values(row)
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: {
          json: row.json,
          stateFingerprint: row.stateFingerprint,
          provenance: row.provenance,
          model: row.model,
          costUsd: row.costUsd,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          generatedAt: row.generatedAt,
        },
      });
  }
}
