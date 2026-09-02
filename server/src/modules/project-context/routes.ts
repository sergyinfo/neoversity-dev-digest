import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MAX_ATTACHMENT_ORDER } from './constants.js';
import { ProjectContextService } from './service.js';
import {
  AttachmentInput,
  AttachmentTargetKind,
  type AttachmentRow,
  type ContextDocList,
  type Projection,
} from './contract.js';

/**
 * L05 — project-context module.
 *
 *   GET    /repos/:id/context              → discovered documents, read live
 *   GET    /agents/:id/context/projection?repo_id=  → REQ-10's per-agent,
 *                                            per-repo projection
 *   GET    /context/attachments            → attachments on one target
 *   POST   /context/attachments            → attach
 *   PATCH  /context/attachments/:id        → reorder
 *   DELETE /context/attachments/:id        → detach
 *
 * ## Why one generic attachments collection rather than a pair per target kind
 *
 * `AttachmentInput` carries `target_kind` and `target_id` as top-level body
 * fields (§10). Against `/agents/:id/context` those two would be redundant with
 * the URL and could contradict it — a body saying `target_kind: 'skill'` posted
 * to an agent route has no defensible meaning. One collection addressed by the
 * body keeps the contract and the route saying the same thing.
 *
 * ## No `response:` schema
 *
 * Deliberate, and consistent: NO route in this server declares one. Responses
 * are typed by the handler's TypeScript return annotation and validated by
 * `project-context-contract.test.ts` parsing live payloads. Adding one here
 * would make this module the odd one out without buying runtime safety anywhere
 * else.
 *
 * Cross-workspace access is a **404, never a 403** — a 403 confirms the row
 * exists. Resolved through `getContext(app.container, req)` in every handler,
 * with the scoping done in SQL rather than after the fact.
 */

/**
 * `target_id` is a uuid for the same reason `IdParams` is
 * (`_shared/schemas.ts:11`, fix-brief F9): it reaches
 * `eq(t.agents.id, targetId)` against a `uuid` column, and a malformed value
 * there is Postgres 22P02 surfacing through `app.ts:160-163` as a 500 that
 * echoes the raw database message.
 */
const ListAttachmentsQuery = z.object({
  target_kind: AttachmentTargetKind,
  target_id: z.string().uuid(),
});

/** Bounded to the `integer` column's range — see `MAX_ATTACHMENT_ORDER` (F10). */
const ReorderBody = z.object({
  order: z.number().int().min(0).max(MAX_ATTACHMENT_ORDER),
});

/** The repository a projection is computed against (F2). See the route below. */
const ProjectionQuery = z.object({ repo_id: z.string().uuid() });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  /**
   * REQ-1. The URL matches the already-shipped client hook
   * (`client/src/lib/hooks/core.ts` `useContextFiles`) exactly — that hook has
   * been calling this path since part-0 with a comment saying it is safe to
   * call once the API exposes it.
   */
  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req): Promise<ContextDocList> => {
    const { workspaceId } = await getContext(app.container, req);
    const list = await service.listDocs(workspaceId, req.params.id);

    // One structured line per request, naming the outcome rather than leaving
    // "empty list" ambiguous between the three things it can mean (F3).
    req.log.info(
      { repoId: req.params.id, files: list.files.length, capped: list.capped, reason: list.reason },
      'project-context: listed documents',
    );
    return list;
  });

  /**
   * REQ-10 — the per-agent projection, computed through the shared assembler.
   *
   * `repo_id` is REQUIRED (fix-brief F2). A projection is "what a run against
   * THIS repository would send", and the cross-repo skip a run applies (D-6)
   * cannot be evaluated without naming that repository. Missing it is a 422
   * through the standard validation envelope rather than a default, because
   * every available default — the attachment's own repo, the first repo, the
   * only repo — silently answers a different question than the one AC-26
   * compares against.
   */
  app.get(
    '/agents/:id/context/projection',
    { schema: { params: IdParams, querystring: ProjectionQuery } },
    async (req): Promise<Projection> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.projectForAgent(workspaceId, req.params.id, req.query.repo_id);
    },
  );

  app.get(
    '/context/attachments',
    { schema: { querystring: ListAttachmentsQuery } },
    async (req): Promise<AttachmentRow[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listAttachments(workspaceId, req.query.target_kind, req.query.target_id);
    },
  );

  app.post(
    '/context/attachments',
    { schema: { body: AttachmentInput } },
    async (req, reply): Promise<AttachmentRow> => {
      const { workspaceId } = await getContext(app.container, req);
      const row = await service.attach(workspaceId, req.body);
      reply.code(201);
      return row;
    },
  );

  app.patch(
    '/context/attachments/:id',
    { schema: { params: IdParams, body: ReorderBody } },
    async (req): Promise<AttachmentRow> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.reorder(workspaceId, req.params.id, req.body.order);
    },
  );

  app.delete(
    '/context/attachments/:id',
    { schema: { params: IdParams } },
    async (req, reply): Promise<null> => {
      const { workspaceId } = await getContext(app.container, req);
      await service.detach(workspaceId, req.params.id);
      reply.code(204);
      return null;
    },
  );
}
