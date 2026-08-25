import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getWorkspaceId } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';
import { summariseBlast } from './summary.js';
import type { BlastResponse, BlastSummaryResponse } from './contract.js';

/**
 * L04 — blast module.
 *   GET  /pulls/:id/blast         → the impact map, served from the prebuilt index
 *   POST /pulls/:id/blast/summary → OPTIONAL one-paragraph explanation (one LLM call)
 *
 * There is deliberately no repo-level route: blast answers a question about a
 * DIFF, and without one there is nothing to be the blast radius of.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req): Promise<BlastResponse> => {
    const workspaceId = await getWorkspaceId(container, req);
    const res = await service.forPull(workspaceId, req.params.id);

    // One structured line per request, and it names its SOURCE.
    // A stated acceptance check is "read the logs: the request must show an
    // index read, not a re-parse of the repository" — so the proof is emitted
    // rather than left to be inferred from the absence of clone I/O.
    req.log.info(
      {
        prId: res.pr_id,
        state: res.state,
        indexedSha: res.indexed_sha,
        symbols: res.counts.symbols,
        callers: res.counts.callers,
        endpoints: res.counts.endpoints,
        crons: res.counts.crons,
        source: 'index',
      },
      'blast: served from index',
    );

    return res;
  });

  // Optional, and explicitly requested. Rate-limited like the other endpoints
  // that spend money (`reviews/routes.ts` sets the precedent) — the GET above
  // stays free and model-free.
  app.post(
    '/pulls/:id/blast/summary',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req): Promise<BlastSummaryResponse> => {
      const workspaceId = await getWorkspaceId(container, req);
      const blast = await service.forPull(workspaceId, req.params.id);
      return summariseBlast(container, workspaceId, blast);
    },
  );
}
