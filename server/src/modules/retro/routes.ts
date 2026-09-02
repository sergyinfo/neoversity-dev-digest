import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RetroLedger } from './contract.js';
import { getContext } from '../_shared/context.js';
import { readLedger } from './ledger.js';

/**
 * retro module — a read-only viewer for `docs/retro/ledger.md`.
 *
 *   GET /retro/ledger → the file's markdown + its mtime
 *
 * SCOPE, stated so the next reader does not widen it: this module does NOT run
 * a retro and does not write one. `/retro` is a Claude Code slash command that
 * a human types; nothing here invokes it, and there is no POST. All this does
 * is make one committed file visible in the app instead of only in an editor.
 *
 * No database, no migration, no `vendor/shared` entry — the ledger is a file in
 * the repo, not workspace data.
 */
export default async function retroRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/retro/ledger', async (req): Promise<RetroLedger> => {
    /**
     * Resolved for consistency with every sibling handler (`server/CLAUDE.md`:
     * "every module uses this so workspace scoping is never forgotten"), and
     * deliberately not used to scope anything: the ledger is a repo file
     * committed to git, identical for every workspace, and there is no
     * `workspace_id` to filter on. Keeping the call means the day this module
     * ever does touch tenant data, the context is already at hand rather than
     * being the thing someone forgot to add.
     */
    await getContext(container, req);

    return readLedger();
  });
}
