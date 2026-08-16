import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ValidationError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';
import { ConventionRepository } from './repository.js';
import { conventionsSkillName, renderSkillBody } from './skill-body.js';

/**
 * L02 — conventions module.
 *   POST  /repos/:id/conventions/extract    → run the extractor (one model call)
 *   GET   /repos/:id/conventions            → candidates for a repo
 *   PATCH /conventions/:id                  → accept / reject / edit the rule
 *   GET   /repos/:id/conventions/skill-draft → rendered draft from ACCEPTED candidates
 *
 * The draft is NOT saved here. Conventions renders; `POST /skills` (skills
 * module) creates. That keeps the modules independent — writing `skills` from
 * here would be a cross-module import — and it matches the UI, where the draft
 * is editable before the user commits to it.
 */

const PatchConventionBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(1).optional(),
    category: z.string().nullish(),
  })
  .refine((b) => b.status !== undefined || b.rule !== undefined || b.category !== undefined, {
    message: 'Provide status, rule or category',
  });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(container);

  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams },
      // One model call per request; keep a bored user from spending real money.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => service.extract((await getContext(container, req)).workspaceId, req.params.id),
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: PatchConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { status, ...patch } = req.body;

      let current =
        patch.rule !== undefined || patch.category !== undefined
          ? await service.edit(workspaceId, req.params.id, patch)
          : null;

      if (status) current = await service.setStatus(workspaceId, req.params.id, status);
      return current;
    },
  );

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const repoId = req.params.id;

      // Read the accepted set from the DB rather than trusting an id list from the
      // client — a rejected candidate must not be able to reach a skill.
      const accepted = await service.acceptedFor(workspaceId, repoId);
      if (accepted.length === 0) {
        throw new ValidationError('No accepted conventions to build a skill from');
      }

      const repoRow = await new ConventionRepository(container.db).getRepo(workspaceId, repoId);
      if (!repoRow) throw new ValidationError('Repo not found');

      return {
        name: conventionsSkillName(repoRow.name),
        description: `${accepted.length} house convention(s) extracted from ${repoRow.fullName}`,
        type: 'convention' as const,
        body: renderSkillBody(repoRow.name, accepted),
        evidence_files: [...new Set(accepted.map((c) => c.evidence_path))],
        from_count: accepted.length,
      };
    },
  );
}
