import type { FastifyPluginAsync } from 'fastify';

import { digestRequestSchema } from './contract.js';
import { DigestService } from './service.js';
import { DigestRepository } from './repository.js';

const digest: FastifyPluginAsync = async (app) => {
  const service = new DigestService(new DigestRepository(app.container.db));

  app.post('/digest', async (request, reply) => {
    const parsed = digestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    const { workspaceId, since, limit } = parsed.data;
    const entries = await service.build(workspaceId, since, limit);
    return reply.send({ entries });
  });
};

export default digest;
