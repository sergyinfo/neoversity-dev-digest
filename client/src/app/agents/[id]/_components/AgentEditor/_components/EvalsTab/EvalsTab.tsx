/* Evals tab (L06) — this agent's eval-case set: three metric cards with
   deltas against the previous batch, and the case list with each case's
   last result. Case CREATION lives on the finding card ("Turn into eval
   case", S8) and RUNNING is one batch over the whole set — there is no
   per-case run endpoint, so the case row offers Delete only, not Run.
   Mirrors the design's `EvalsTab`/`EvalMetricStrip` (screen_agents.jsx),
   scoped down to what `evals.ts`'s hooks actually expose. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, MetricCard, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentEvalDashboard, useDeleteEvalCase, useEvalCases, useRunEvalSet } from "@/lib/hooks/evals";
import type { EvalRunRecord } from "@/lib/types";
import { s } from "./styles";

/** The most recent run per case (chronological, from the dashboard's
 * `recent_runs`) — there is no per-case "last result" field on `EvalCase`
 * itself, so this is derived on the client from the runs the dashboard
 * already returns. */
function latestRunByCase(runs: EvalRunRecord[] | undefined): Map<string, EvalRunRecord> {
  const byCase = new Map<string, EvalRunRecord>();
  const sorted = [...(runs ?? [])].sort((a, b) => a.ran_at.localeCompare(b.ran_at));
  for (const run of sorted) byCase.set(run.case_id, run); // later overwrites earlier
  return byCase;
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const cases = useEvalCases(agent.id);
  const dashboard = useAgentEvalDashboard(agent.id);
  const runSet = useRunEvalSet(agent.id);
  const deleteCase = useDeleteEvalCase(agent.id);

  const lastRuns = React.useMemo(
    () => latestRunByCase(dashboard.data?.recent_runs),
    [dashboard.data?.recent_runs],
  );

  const current = dashboard.data?.current;
  const delta = dashboard.data?.delta;
  // REC-2: the server names the TP+FP=0 condition via `alert` — that is the
  // signal, not the precision NUMBER itself (which the scorer sets to 1 in
  // that exact case, so it cannot be distinguished from a genuinely perfect
  // score any other way).
  const precisionNA = !!dashboard.data?.alert;

  const caseCount = cases.data?.length ?? 0;
  const runAll = () => runSet.mutate();

  return (
    <div style={s.wrap}>
      <SectionLabel icon="Gauge">{t("evalsTab.metricsTitle")}</SectionLabel>
      <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>

      {dashboard.isLoading ? (
        <div style={s.metricsRow}>
          <Skeleton height={94} />
          <Skeleton height={94} />
          <Skeleton height={94} />
        </div>
      ) : (
        <div style={s.metricsRow}>
          <MetricCard
            label={t("dashboard.metrics.recall")}
            value={current ? Math.round(current.recall * 100) : 0}
            suffix="%"
            delta={delta?.recall}
            color="var(--accent)"
          />
          <MetricCard
            label={t("dashboard.metrics.precision")}
            value={precisionNA ? "n/a" : current ? Math.round(current.precision * 100) : 0}
            suffix={precisionNA ? undefined : "%"}
            delta={precisionNA ? undefined : delta?.precision}
            color="var(--ok)"
          />
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            value={current ? Math.round(current.citation_accuracy * 100) : 0}
            suffix="%"
            delta={delta?.citation_accuracy}
            color="var(--warn)"
          />
        </div>
      )}

      <div style={s.casesHeader}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        <Badge color="var(--text-muted)">{caseCount}</Badge>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            disabled={caseCount === 0 || runSet.isPending}
            onClick={runAll}
          >
            {runSet.isPending ? t("dashboard.running") : t("dashboard.runEval", { count: caseCount })}
          </Button>
        </div>
      </div>

      {cases.isLoading ? (
        <p style={s.rowResult}>{t("evalsTab.loadingCases")}</p>
      ) : caseCount === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
      ) : (
        <div style={s.list}>
          {(cases.data ?? []).map((c) => {
            const last = lastRuns.get(c.id);
            const deleting = deleteCase.isPending && deleteCase.variables === c.id;
            const StatusIcon = !last ? Icon.Dot : last.pass ? Icon.CheckCircle : Icon.XCircle;
            const statusColor = !last ? "var(--text-muted)" : last.pass ? "var(--ok)" : "var(--crit)";
            return (
              <div key={c.id} style={s.row}>
                <StatusIcon size={15} style={{ color: statusColor, flexShrink: 0 }} />
                <div style={s.rowBody}>
                  <div style={s.rowName}>{c.name}</div>
                  <div style={s.rowResult}>
                    {!last
                      ? t("evalsTab.neverRun")
                      : (last.pass ? t("evalsTab.passed") : t("evalsTab.failed")) +
                        (last.recall != null
                          ? t("evalsTab.recallSuffix", { recall: Math.round(last.recall * 100) })
                          : "")}
                  </div>
                </div>
                <div style={s.rowActions}>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="Trash"
                    disabled={deleting}
                    onClick={() => deleteCase.mutate(c.id)}
                  >
                    {t("evalsTab.delete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(runSet.isError || deleteCase.isError) && (
        <div style={s.error}>
          {runSet.error instanceof Error
            ? runSet.error.message
            : deleteCase.error instanceof Error
              ? deleteCase.error.message
              : "Could not complete the request"}
        </div>
      )}
    </div>
  );
}
