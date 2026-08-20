import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * L03 — Smart Diff.
 *   GET /pulls/:id/smart-diff → the PR's files grouped core / wiring /
 *   boilerplate, ordered by risk, with the latest review's finding lines.
 *
 * Deliberately NOT rate-limited and NOT cached: it is a pure read over rows that
 * are already loaded, with no model call and no outbound I/O behind it. That is
 * also why it is safe to refetch after a review finishes to pick up new badges.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return new SmartDiffService(container).forPull(workspaceId, req.params.id);
  });
}
