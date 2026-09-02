import type { FastifyPluginAsync } from 'fastify';

import { InsightService } from './service.js';
import { InsightRepository } from './repository.js';

const insights: FastifyPluginAsync = async (app) => {
  const service = new InsightService(
    new InsightRepository(app.container.db),
    app.container,
    app.container.db
  );

  app.get('/insights/:repoId', async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const workspaceId = request.headers['x-workspace-id'] as string;

    const found = await service.refresh(workspaceId, repoId);

    const highConfidence = found.filter((insight) => insight.confidence === 'high');
    const promoted = found.filter(
      (insight) => insight.confidence === 'medium' && insight.finding.length > 500
    );
    const ranked = [...highConfidence, ...promoted].sort((a, b) =>
      a.confidence === b.confidence ? a.finding.length - b.finding.length : 0
    );

    if (ranked.length === 0 && found.length > 0) {
      return reply.send({ insights: found.slice(0, 3), degraded: true });
    }

    return reply.send({ insights: ranked, degraded: false });
  });
};

export default insights;
