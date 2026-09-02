import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({ repoIdx: index('code_chunks_repo_idx').on(t.repoId) }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `context_attachments` — L05 Project Context. One row = one repo document
 * attached to one agent OR one skill.
 *
 * ## Why two nullable FKs instead of a polymorphic `target_id` (plan R1)
 *
 * §7 requires an attachment to disappear with the agent or skill it is attached
 * to. A single polymorphic `target_id` column cannot carry a foreign key, so it
 * cannot cascade — the lifecycle would have to be enforced in application code
 * and would silently rot. Instead the table carries BOTH `agent_id` and
 * `skill_id` as nullable FKs, each `ON DELETE CASCADE`, and a CHECK asserts
 * that exactly one of them is set:
 *
 *     CHECK (num_nonnulls(agent_id, skill_id) = 1)
 *
 * `target_kind`/`target_id` remain the WIRE shape (§10, module `contract.ts`);
 * the two-column form is the STORAGE shape, mapped at the repository boundary.
 *
 * ## Why two PARTIAL unique indexes, not one four-column one (cross-review F1)
 *
 * In a standard Postgres unique index NULL is distinct from NULL, so a unique
 * index on `(agent_id, skill_id, repo_id, path)` would happily admit two
 * IDENTICAL agent attachments — both carrying `skill_id = NULL`. `db:generate`
 * would succeed and the duplicate would land. The real invariant is two rules,
 * one per target kind, and that is what is declared here.
 *
 * `UNIQUE NULLS NOT DISTINCT` was available (this deployment is PG16 —
 * `docker-compose.yml:5`, `test/helpers/pg.ts:36`) and was rejected on MEANING,
 * not capability: it yields the right answer only BECAUSE the `num_nonnulls`
 * CHECK guarantees exactly one column is non-null, so relaxing that CHECK would
 * silently change the uniqueness rule. The partial indexes state the invariant
 * directly, and each doubles as the lookup index for its target kind
 * (`resolveForAgent` queries by `agent_id`).
 *
 * Note also that `nullsNotDistinct()` lives on the table CONSTRAINT builder
 * (`pg-core/unique-constraint.d.ts:10`), not on `uniqueIndex()` — reaching for
 * it here is a typecheck error.
 *
 * ## `order`
 *
 * Named `order` to match both the wire field (`AttachmentInput.order`) and the
 * existing `agent_skills.order` precedent. It IS a SQL reserved word, but
 * drizzle quotes every identifier it emits (`"order" integer` already ships in
 * `0000_init.sql:22`), so this is a naming-clarity call rather than a defect.
 * Any hand-written raw SQL touching it must quote it.
 *
 * `workspace_id` is carried per the repo-wide tenancy rule — note that
 * `agent_skills` does NOT carry one, so it is a precedent for the ordering
 * model only, never for tenancy.
 */
export const contextAttachments = pgTable(
  'context_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The repo the path was discovered in. A path is meaningless without it. */
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Exactly one of `agentId` / `skillId` is non-null — see the CHECK below. */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    /** Repo-relative POSIX path, as listed by the discovery walk. */
    path: text('path').notNull(),
    /** Position within the section, ascending. Resolved on the way in. */
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({
    /** §7: exactly one target. The premise the partial indexes rest on. */
    targetCk: check(
      'ctx_att_one_target_ck',
      sql`num_nonnulls(${t.agentId}, ${t.skillId}) = 1`,
    ),
    /** F1: NULL-safe uniqueness per target kind; also the agent lookup index. */
    agentUq: uniqueIndex('ctx_att_agent_repo_path_uq')
      .on(t.agentId, t.repoId, t.path)
      .where(sql`agent_id is not null`),
    skillUq: uniqueIndex('ctx_att_skill_repo_path_uq')
      .on(t.skillId, t.repoId, t.path)
      .where(sql`skill_id is not null`),
    /** Tenancy-scoped listing for one repo. */
    wsRepoIdx: index('ctx_att_ws_repo_idx').on(t.workspaceId, t.repoId),
  }),
);
