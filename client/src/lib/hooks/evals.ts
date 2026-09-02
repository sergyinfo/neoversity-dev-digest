/* hooks/evals.ts — the Eval Pipeline (L06): turn a labelled finding into a
   case, run an agent over its whole case set from stored inputs only, and read
   the resulting dashboards.

     POST   /findings/:id/eval-case      → EvalCase (existing or new; idempotent)
     GET    /agents/:id/eval-cases       → EvalCase[]
     DELETE /eval-cases/:id              → { ok: boolean }
     POST   /agents/:id/eval-runs        → EvalRunResult[] (synchronous, one row per case)
     GET    /agents/:id/eval-runs        → EvalBatchSummary[] (batch list, BQ-4a)
     GET    /agents/:id/eval-dashboard   → EvalDashboard
     GET    /eval-dashboard              → EvalDashboard (workspace-wide) */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EvalCase, EvalRunResult, EvalDashboard, EvalRunRecord } from "../types";
import type { Finding } from "@devdigest/shared";

/**
 * One linked skill AT RUN TIME (REC-6). `content_hash` is what lets the
 * compare modal (T4) say "prompts identical, a skill changed" instead of an
 * unexplained metric move.
 */
export interface EvalSkillSnapshot {
  id: string;
  name: string;
  version: number;
  content_hash: string;
}

/**
 * The agent AT RUN TIME (REC-1) — `id`/`name` are required so a workspace-wide
 * table can say which agent a row belongs to.
 */
export interface EvalAgentSnapshot {
  id: string;
  name: string;
  system_prompt: string;
  model: string;
  skills: EvalSkillSnapshot[];
}

/**
 * The `actual_output` HTTP envelope. Kept LOCAL — not in `@devdigest/shared` —
 * following the precedent `hooks/blast.ts` set for `BlastResponse`
 * (`client/INSIGHTS.md`, 2026-08-23): the persisted row shape (`EvalRunRecord`)
 * really is shared, but the jsonb envelope it carries is module-local to the
 * server (`server/src/modules/evals/contract.ts`) because no route in this
 * server declares a `response:` schema — a shared Zod contract here would buy
 * types only, at the cost of widening the two-vendored-copies byte-identity
 * surface. Its shape is fixed by that file, not restated by choice.
 */
export interface ActualOutput {
  batch_id: string;
  findings: Finding[];
  grounded_ids: string[];
  matches: { expectation_index: number; finding_id: string | null }[];
  agent: EvalAgentSnapshot;
}

/**
 * One BATCH — the aggregate of every `eval_runs` row sharing a `batch_id`
 * (BQ-4a: the batch, not the individual run, is the unit Compare takes two
 * of). Local for the same reason as `ActualOutput`: `EvalBatchSummary` lives
 * in `server/src/modules/evals/contract.ts`, not in `@devdigest/shared`.
 */
export interface EvalBatchSummary {
  batch_id: string;
  ran_at: string;
  recall: number;
  precision: number;
  citation_accuracy: number;
  traces_passed: number;
  traces_total: number;
  cost_usd: number | null;
  agent: EvalAgentSnapshot | null;
}

/**
 * `GET /eval-dashboard`'s per-agent row — ADDITIVE to the given `EvalDashboard`
 * contract, which carries no per-agent breakdown at all. The server derives
 * this from the batch list it already loads (no extra query per agent); it is
 * untyped by `@devdigest/shared` for the same reason `ActualOutput` above is —
 * no route in this server declares a `response:` schema, so nothing validates
 * it on the way out. Declared locally per the `blast.ts` precedent, landed by
 * T1 (server core) after T3's hooks did — see `server/src/modules/evals/service.ts`
 * (`AgentEvalSummary`).
 */
export interface AgentEvalSummary {
  agent_id: string;
  agent_name: string;
  cases_total: number;
  current: EvalDashboard["current"];
  delta: EvalDashboard["delta"];
  last_ran_at: string | null;
}

/**
 * A `recent_runs` row widened with a FALLBACK agent attribution. The primary
 * source for "which agent does this row belong to" is always the envelope's
 * `actual_output.agent.name` (REC-1); these two fields are additive and exist
 * only for a row whose envelope carries no snapshot (the same nullable-agent
 * case `EvalBatchSummary.agent` documents) — prefer the envelope, fall back to
 * these, and only then show "unknown".
 */
export type EvalRunRecordWithAgent = EvalRunRecord & {
  agent_id: string;
  agent_name: string | null;
};

/**
 * `GET /eval-dashboard`'s actual response shape: `EvalDashboard` widened with
 * `agents` (AC-17 — "every agent with its latest metrics" in one request) and
 * `recent_runs` rows carrying the fallback attribution above.
 */
export interface WorkspaceEvalDashboard extends Omit<EvalDashboard, "recent_runs"> {
  recent_runs: EvalRunRecordWithAgent[];
  agents: AgentEvalSummary[];
}

// ---- Query keys ----
const casesKey = (agentId: string | null | undefined) => ["eval-cases", agentId] as const;
const batchesKey = (agentId: string | null | undefined) => ["eval-batches", agentId] as const;
const agentDashboardKey = (agentId: string | null | undefined) =>
  ["eval-dashboard", agentId] as const;
const workspaceDashboardKey = ["eval-dashboard", null] as const;

/** GET /agents/:id/eval-cases — the agent's whole labelled set. */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: casesKey(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/**
 * POST /findings/:id/eval-case — turn one finding into a case. `agentId` is
 * BQ-2a's body fallback: pass `review.agent_id` here so the server can resolve
 * the owning agent when the review itself was attributed to none.
 */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, agentId }: { findingId: string; agentId?: string | null }) =>
      api.post<EvalCase>(
        `/findings/${findingId}/eval-case`,
        agentId ? { agent_id: agentId } : undefined,
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: casesKey(data.owner_id) });
      qc.invalidateQueries({ queryKey: agentDashboardKey(data.owner_id) });
      qc.invalidateQueries({ queryKey: workspaceDashboardKey });
    },
  });
}

/** DELETE /eval-cases/:id — remove a case. */
export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: casesKey(agentId) });
      qc.invalidateQueries({ queryKey: agentDashboardKey(agentId) });
      qc.invalidateQueries({ queryKey: workspaceDashboardKey });
    },
  });
}

/**
 * POST /agents/:id/eval-runs — run the whole set. Synchronous (BQ-5a): no SSE,
 * no job runner, no run-status surface. Costs one model call per case, so it
 * stays a mutation rather than firing from a render or a refetch.
 */
export function useRunEvalSet(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunResult[]>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: casesKey(agentId) });
      qc.invalidateQueries({ queryKey: batchesKey(agentId) });
      qc.invalidateQueries({ queryKey: agentDashboardKey(agentId) });
      qc.invalidateQueries({ queryKey: workspaceDashboardKey });
    },
  });
}

/** GET /agents/:id/eval-runs — the batch list (BQ-4a), newest first. */
export function useEvalBatches(agentId: string | null | undefined) {
  return useQuery({
    queryKey: batchesKey(agentId),
    queryFn: () => api.get<EvalBatchSummary[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** GET /agents/:id/eval-dashboard — one agent's aggregate + trend. */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentDashboardKey(agentId),
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

/** GET /eval-dashboard — every agent + recent runs, workspace-wide. */
export function useWorkspaceEvalDashboard() {
  return useQuery({
    queryKey: workspaceDashboardKey,
    queryFn: () => api.get<WorkspaceEvalDashboard>("/eval-dashboard"),
  });
}
