import type { FastifyPluginAsync } from 'fastify';
import pulls from './pulls/routes.js';
import conventions from './conventions/routes.js';

export const modules: Record<string, FastifyPluginAsync> = {
  pulls,
  conventions,
};
