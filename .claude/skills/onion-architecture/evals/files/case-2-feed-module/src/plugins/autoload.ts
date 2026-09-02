import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';

const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');

export async function registerModules(app: FastifyInstance): Promise<string[]> {
  const entries = await readdir(MODULES_DIR, { withFileTypes: true });
  const registered: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const routes = path.join(MODULES_DIR, entry.name, 'routes.js');
    const plugin = await import(routes);
    await app.register(plugin.default, { prefix: `/api/${entry.name}` });
    registered.push(entry.name);
  }

  return registered;
}
