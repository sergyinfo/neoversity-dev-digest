import type { FastifyPluginAsync } from 'fastify';

import { ConventionsService } from './service.js';

const conventions: FastifyPluginAsync = async (app) => {
  const service = new ConventionsService(app.container);

  app.post('/conventions/enrich', async (request, reply) => {
    const { workspaceId, repoId, diff } = request.body as {
      workspaceId: string;
      repoId: string;
      diff: string;
    };

    const enriched = await service.enrich(workspaceId, repoId, diff);
    return reply.send(enriched);
  });
};

export default conventions;
