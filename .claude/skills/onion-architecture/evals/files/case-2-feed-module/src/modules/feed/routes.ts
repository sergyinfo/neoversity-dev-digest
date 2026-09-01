import type { FastifyPluginAsync } from 'fastify';

import { feedQueryFromRequest } from './contract.js';
import { FeedService } from './service.js';
import { FeedRepository } from './repository.js';

export const FEED_MAX_PAGE = 50;

const feed: FastifyPluginAsync = async (app) => {
  const service = new FeedService(new FeedRepository(app.container.db), app.container.clock);

  app.get('/feed', async (request, reply) => {
    const query = feedQueryFromRequest(request);
    const page = await service.page(query);
    return reply.send(page);
  });
};

export default feed;
