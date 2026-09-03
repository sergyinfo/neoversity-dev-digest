import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { EvalCase, EvalDashboard, EvalRunResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CreateEvalCaseBody, RunEvalBody, type EvalBatchSummary } from './contract.js';
import { EvalsService, type WorkspaceEvalDashboard } from './service.js';

/**
 * L06 — the eval pipeline module.
 *
 *   POST   /findings/:id/eval-case    → one-click case creation from a finding
 *   GET    /agents/:id/eval-cases     → the agent's set
 *   DELETE /eval-cases/:id            → remove a case
 *   POST   /agents/:id/eval-runs      → run the whole set (synchronous)
 *   GET    /agents/:id/eval-runs      → the BATCH list (see below)
 *   GET    /agents/:id/eval-dashboard → EvalDashboard for one agent
 *   GET    /eval-dashboard            → workspace-wide
 *
 * ## `GET /agents/:id/eval-runs` is an addition to the approved spec
 *
 * The spec's Contracts table lists six routes and not this one. It follows from
 * **BQ-4a — the batch is the unit**: Compare takes two `batch_id`s, the run
 * history table lists batches, and a client whose connection died mid-run
 * recovers the partial batch here (cross-review CR-5). Called out deliberately
 * so a reviewer reads it as a decision, not as scope creep.
 *
 * ## No `response:` schema
 *
 * Consistent with every other module in this server (`project-context/routes.ts`
 * says the same): responses are typed by the handler's return annotation.
 * Declaring one here would make this module the odd one out and would strip the
 * two additive keys the dashboards carry (`agents`, `agent_name`) on the way out.
 *
 * ## Tenancy
 *
 * `getContext(app.container, req)` in EVERY handler, and the scoping is done in
 * SQL. Cross-workspace access is a **404, never a 403** — a 403 confirms the row
 * exists.
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalsService(app.container);

  /**
   * AC-1/AC-2/AC-5. The body carries an owner hint and NOTHING else — no
   * `expected_output` (Sec-2): the expectation is derived server-side from the
   * server's own finding row, because a client that could post one could make
   * any agent pass any case.
   *
   * 201 when a case was created, 200 when an existing one was returned. Both
   * carry the same body, so a client that ignores the status still behaves.
   */
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply): Promise<EvalCase> => {
      const { workspaceId } = await getContext(app.container, req);
      const { evalCase, created } = await service.createFromFinding(
        workspaceId,
        req.params.id,
        req.body.agent_id,
      );
      reply.code(created ? 201 : 200);
      req.log.info(
        { findingId: req.params.id, caseId: evalCase.id, created },
        created ? 'evals: eval case created from finding' : 'evals: existing eval case returned',
      );
      return evalCase;
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams } },
    async (req): Promise<EvalCase[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams } },
    async (req, reply): Promise<null> => {
      const { workspaceId } = await getContext(app.container, req);
      await service.deleteCase(workspaceId, req.params.id);
      reply.code(204);
      return null;
    },
  );

  /**
   * The run. Synchronous by decision (BQ-5a), capped at 50 cases, and rate
   * limited exactly as `POST /pulls/:id/review` is (REC-5) — both fan out to N
   * expensive model calls, and this one does so from a single click.
   *
   * NOTE: `app.ts:95-97` registers `@fastify/rate-limit` only when
   * `nodeEnv !== 'test'`, so this config is INERT under the test suites. It is
   * asserted structurally in `evals-routes.test.ts` rather than by hammering.
   */
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, body: RunEvalBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<EvalRunResult[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runSet(workspaceId, req.params.id, req.log);
    },
  );

  /** The batch list — the addition documented at the top of this file. */
  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams } },
    async (req): Promise<EvalBatchSummary[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listBatches(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams } },
    async (req): Promise<EvalDashboard> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.dashboardForAgent(workspaceId, req.params.id);
    },
  );

  app.get('/eval-dashboard', async (req): Promise<WorkspaceEvalDashboard> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboardForWorkspace(workspaceId);
  });
}
