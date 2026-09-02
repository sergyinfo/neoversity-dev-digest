import type { FastifyPluginAsync } from 'fastify';
import pulls from './pulls/routes.js';
import brief from './brief/routes.js';

export const modules: Record<string, FastifyPluginAsync> = {
  pulls,
  brief,
};
