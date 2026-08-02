import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillRepository, toSkillDto } from './repository.js';
import { fetchSkillFromUrl } from './import.js';

/**
 * L02 — skills module.
 *   GET    /skills             → list (workspace-scoped)
 *   GET    /skills/:id         → one skill
 *   POST   /skills             → create
 *   PUT    /skills/:id         → update (a body change bumps the version)
 *   DELETE /skills/:id         → remove (cascades the agent links)
 *   GET    /skills/:id/versions → body history
 *   POST   /skills/import      → create from a URL (source = imported_url)
 *
 * Near-CRUD, so routes talk to the repository directly rather than through an
 * empty pass-through service — the thin-module exemption in the
 * onion-architecture skill. The one piece of real logic (fetching and parsing a
 * remote skill) lives in `import.ts`, not in a handler.
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType.default('custom'),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const ImportSkillBody = z.object({
  url: z.string().url(),
  /** Optional overrides — otherwise taken from the fetched frontmatter. */
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const repo = new SkillRepository(container.db);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return (await repo.list(workspaceId)).map(toSkillDto);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const row = await repo.getById(workspaceId, req.params.id);
    if (!row) throw new NotFoundError('Skill not found');
    return toSkillDto(row);
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const b = req.body;

    // Names are the handle an agent's prompt is reasoned about by, so keep them
    // unique per workspace rather than letting two "breaking-change" skills exist.
    if (await repo.findByName(workspaceId, b.name)) {
      throw new ValidationError(`A skill named "${b.name}" already exists`);
    }

    const row = await repo.insert({
      workspaceId,
      name: b.name,
      description: b.description,
      type: b.type,
      source: 'manual',
      body: b.body,
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.evidence_files ? { evidenceFiles: b.evidence_files } : {}),
    });
    reply.code(201);
    return toSkillDto(row);
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const row = await repo.update(workspaceId, req.params.id, req.body);
    if (!row) throw new NotFoundError('Skill not found');
    return toSkillDto(row);
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await repo.remove(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    reply.code(204);
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const row = await repo.getById(workspaceId, req.params.id);
    if (!row) throw new NotFoundError('Skill not found');
    return (await repo.listVersions(row.id)).map((v) => ({
      version: v.version,
      body: v.body,
      created_at: v.createdAt,
    }));
  });

  app.post(
    '/skills/import',
    {
      schema: { body: ImportSkillBody },
      // Fetches a remote URL — rate-limited so it cannot be used to hammer a host.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const fetched = await fetchSkillFromUrl(req.body.url);

      const name = req.body.name ?? fetched.name;
      if (await repo.findByName(workspaceId, name)) {
        throw new ValidationError(`A skill named "${name}" already exists`);
      }

      const row = await repo.insert({
        workspaceId,
        name,
        description: req.body.description ?? fetched.description,
        type: req.body.type ?? 'custom',
        source: 'imported_url',
        body: fetched.body,
      });
      reply.code(201);
      return toSkillDto(row);
    },
  );
}
