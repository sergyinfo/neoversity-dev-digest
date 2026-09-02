import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import type { BriefResponse } from './contract.js';
import { BriefService } from './service.js';

/**
 * L05 — the PR Why + Risk Brief.
 *   GET  /pulls/:id/brief  → the stored brief, or `null`. Cache-only, model-free.
 *   POST /pulls/:id/brief  → assemble it now (exactly one model call).
 *
 * ── THE GET RETURNS A BARE `null`, NOT A 404 AND NOT A WRAPPER ────────────
 *
 * Two shapes were available and both are wrong for this route:
 *
 *  - **404** would make "you have not generated one yet" — the normal state of
 *    a feature nobody has pressed yet — indistinguishable from "that PR does
 *    not exist". The card would render an error where it should render its
 *    empty state and a Generate button, and `isError` would stop meaning
 *    anything (REQ-9 / AC-22).
 *  - **`{ brief: null }`** would be a second envelope for the same data. The
 *    committed client hook types this response as `BriefResponse | null`
 *    (`client/src/lib/hooks/brief.ts`), and nothing typechecks across that
 *    boundary — a wrapper would compile on both sides and fail at runtime, in
 *    the card, well away from here.
 *
 * ── RATE LIMITING IS ASYMMETRIC ON PURPOSE ────────────────────────────────
 *
 * The GET carries **no** per-route override: by REQ-9 it is model-free and
 * outbound-free, so the global 120/min ceiling registered in `app.ts` is the
 * right and only limit — the Overview tab opens it on every PR open. The POST
 * spends real money on every call, so it takes the same 5/min override the two
 * other money-spending routes use (`intent/routes.ts`,
 * `blast/routes.ts`). Note that `app.ts:95-97` registers the limiter only when
 * `nodeEnv !== 'test'`, so this override is INERT under a test-config app —
 * `brief.it.test.ts` therefore builds a development-config app to assert it.
 */

/** `regenerate` forces a fresh assembly over a brief whose inputs are unchanged. */
const GenerateBriefBody = z
  .object({
    /**
     * Default `false`, so a plain POST is "generate if needed" and costs
     * nothing when every input is unchanged (REQ-9/AC-18). Only an explicit
     * `true` — a user pressing Regenerate — pays for a replacement.
     */
    regenerate: z.boolean().optional(),
  })
  // A body is optional entirely: `POST` with no payload means "generate".
  .nullish();

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<BriefResponse | null> => {
      const { workspaceId } = await getContext(container, req);
      const service = new BriefService(container, req.log);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: GenerateBriefBody },
      // One model call per request; keep a bored user from spending real money.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(container, req);
      const service = new BriefService(container, req.log);
      return service.assemble(workspaceId, req.params.id, {
        regenerate: req.body?.regenerate ?? false,
      });
    },
  );
}
