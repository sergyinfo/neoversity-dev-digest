import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * Trust band for the derivation. Defaults to the LOWEST band so rows written
   * before the Intent Layer (and any future writer that forgets it) read as
   * weakly-evidenced rather than silently authoritative.
   */
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] })
    .notNull()
    .default('low'),
  /** Which signals the intent was derived from (IntentSource[]). */
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Head the intent was derived against; a moved head marks it stale. */
  headSha: text('head_sha'),
  /** Model that produced it, for auditing a cheap-tier classification. */
  model: text('model'),
  // Written out in full rather than via the `now()` helper, which hardcodes the
  // column name `created_at`.
  derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One PR Why/Risk Brief per PR (L05). Tenancy scopes transitively through
 * `pr_id` — there is no `workspace_id` here, so ownership must be verified
 * BEFORE this row is read.
 *
 * Every column below `json` is nullable: the widening (spec REQ-8/REQ-15) is
 * additive over a table that shipped in `0000_init.sql` with no writers, so it
 * migrates without a backfill and a pre-widening row still reads.
 */
export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  /** The brief document itself (a grounded `BriefDocument`). Unchanged. */
  json: jsonb('json').notNull(),
  /**
   * REQ-8's state fingerprint — both halves of `BriefFingerprint` in one
   * column. Only the `local` half is recomputed on the read path (D-1a).
   */
  stateFingerprint: text('state_fingerprint'),
  /** REQ-15's content-free provenance record (a `BriefProvenance`). */
  provenance: jsonb('provenance'),
  /** The resolved feature model that produced it. */
  model: text('model'),
  /** Read from the provider result, never recomputed. */
  costUsd: doublePrecision('cost_usd'),
  /** The provider's own token counts — the estimate is judged against these. */
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /**
   * When the model was called. Under D-1a this is the only thing that dates
   * the linked issue and the reference documents the brief read. Written out
   * in full rather than via the `now()` helper, which hardcodes `created_at`.
   */
  generatedAt: timestamp('generated_at', { withTimezone: true }),
});
