import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { IntentService } from './service.js';

/**
 * L03 — Intent Layer.
 *   GET  /pulls/:id/intent  → the stored intent (404 until one is derived)
 *   POST /pulls/:id/intent  → derive/re-derive it now (one cheap model call)
 *
 * The UI does NOT read the GET route: intent rides along on `PrDetail` so the PR
 * page has one source of truth (see modules/pulls/routes.ts). This route exists
 * for API completeness and for scripting a re-derivation.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const service = new IntentService(container, req.log);
    const intent = await service.get(workspaceId, req.params.id);
    if (!intent) throw new NotFoundError('No intent derived for this PR yet');
    return intent;
  });

  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams },
      // One model call per request; keep a bored user from spending real money.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const service = new IntentService(container, req.log);
      return service.compute(workspaceId, req.params.id);
    },
  );
}
