/* EvalDashboardView (L06, S10 + S11) — `/eval`: every agent's latest recall /
   precision / citation, a per-agent metric trend + batch history, and a
   two-batch compare (S11). Mirrors the design's `AgentEvalOverview` +
   `ScreenEval` (screen_skills.jsx), folded into one component with a
   `selectedAgentId` switch — this codebase's hooks are agent-scoped for the
   trend/batches, so the drill-down is a real navigation, not decoration. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, EmptyState, Icon, LineChart, MetricCard, SectionLabel, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import {
  useAgentEvalDashboard,
  useEvalBatches,
  useWorkspaceEvalDashboard,
  type ActualOutput,
  type EvalBatchSummary,
} from "@/lib/hooks/evals";
import { formatCost } from "@/lib/cost";
import { CompareModal } from "../CompareModal";
import { s } from "./styles";

const TABLE_COLS_OVERVIEW = "150px 130px 70px 70px 70px 80px";
const TABLE_COLS_BATCHES = "34px 150px 70px 70px 70px 90px 80px";

/**
 * REC-2's rendering of a vacuous precision. Distinct from the "—" used for a
 * value that is simply ABSENT (an agent that has never run): "n/a" means the
 * run happened and the number it produced is not meaningful. The same literal
 * the drill-down `MetricCard` already uses, kept as one constant so the three
 * surfaces cannot drift apart.
 */
const NOT_APPLICABLE = "n/a";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** The envelope's own agent snapshot, read defensively — `actual_output` is
 * `unknown` on the wire (no route declares a `response:` schema). */
function envelopeAgentName(actualOutput: unknown): string | null {
  if (!actualOutput || typeof actualOutput !== "object") return null;
  const agent = (actualOutput as Partial<ActualOutput>).agent;
  return agent && typeof agent.name === "string" ? agent.name : null;
}

export function EvalDashboardView() {
  const t = useTranslations("eval");

  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = React.useState<string[]>([]);
  const [compare, setCompare] = React.useState<{ old: EvalBatchSummary; next: EvalBatchSummary } | null>(null);

  const agents = useAgents();
  const workspace = useWorkspaceEvalDashboard();
  const agentDashboard = useAgentEvalDashboard(selectedAgentId);
  const batches = useEvalBatches(selectedAgentId);

  const openAgent = (id: string) => {
    setSelectedAgentId(id);
    setSelectedBatchIds([]);
  };
  const backToOverview = () => {
    setSelectedAgentId(null);
    setSelectedBatchIds([]);
  };

  const toggleBatch = (id: string) =>
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openCompare = () => {
    const rows = (batches.data ?? []).filter((b) => selectedBatchIds.includes(b.batch_id));
    if (rows.length !== 2) return;
    const [a, b] = [...rows].sort((x, y) => x.ran_at.localeCompare(y.ran_at));
    setCompare({ old: a!, next: b! });
  };

  const selectedAgent = (agents.data ?? []).find((a) => a.id === selectedAgentId);
  const crumb = selectedAgentId
    ? [
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard") },
        { label: selectedAgent?.name ?? t("page.crumbEvals") },
      ]
    : [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  // ------------------------------------------------------------------------
  // Drill-down: one agent's trend + batch history + compare.
  // ------------------------------------------------------------------------
  if (selectedAgentId) {
    const dash = agentDashboard.data;
    const precisionNA = !!dash?.alert;
    const trendPoints = dash?.trend ?? [];

    return (
      <AppShell crumb={crumb}>
        {compare && <CompareModal oldBatch={compare.old} newBatch={compare.next} onClose={() => setCompare(null)} />}
        <div style={s.page}>
          <button type="button" style={s.backBtn} onClick={backToOverview}>
            <Icon.ChevronLeft size={16} />
            {t("page.crumbEvalDashboard")}
          </button>

          <div style={s.headerRow}>
            <div>
              <h1 style={s.h1}>{selectedAgent?.name ?? t("page.crumbEvals")}</h1>
              {dash && <p style={s.subtitle}>{t("dashboard.casesSummary", { count: dash.cases_total, runs: dash.recent_runs.length })}</p>}
            </div>
          </div>

          {agentDashboard.isLoading ? (
            <Skeleton height={220} />
          ) : (
            <>
              <div style={s.metricsRow}>
                <MetricCard
                  label={t("dashboard.metrics.recall")}
                  value={dash ? Math.round(dash.current.recall * 100) : 0}
                  suffix="%"
                  delta={dash?.delta.recall}
                  color="var(--accent)"
                  trend={trendPoints.map((p) => p.recall)}
                />
                <MetricCard
                  label={t("dashboard.metrics.precision")}
                  value={precisionNA ? NOT_APPLICABLE : dash ? Math.round(dash.current.precision * 100) : 0}
                  suffix={precisionNA ? undefined : "%"}
                  delta={precisionNA ? undefined : dash?.delta.precision}
                  color="var(--ok)"
                  trend={precisionNA ? undefined : trendPoints.map((p) => p.precision)}
                />
                <MetricCard
                  label={t("dashboard.metrics.citationAccuracy")}
                  value={dash ? Math.round(dash.current.citation_accuracy * 100) : 0}
                  suffix="%"
                  delta={dash?.delta.citation_accuracy}
                  color="var(--warn)"
                  trend={trendPoints.map((p) => p.citation_accuracy)}
                />
              </div>

              <div style={s.sectionGap}>
                <div style={s.chartHeader}>
                  <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
                  <div style={s.legend}>
                    <span style={s.legendItem}>
                      <span style={{ ...s.legendSwatch, background: "var(--accent)" }} />
                      {t("dashboard.legend.recall")}
                    </span>
                    <span style={s.legendItem}>
                      <span style={{ ...s.legendSwatch, background: "var(--ok)" }} />
                      {t("dashboard.legend.precision")}
                    </span>
                    <span style={s.legendItem}>
                      <span style={{ ...s.legendSwatch, background: "var(--warn)" }} />
                      {t("dashboard.legend.citation")}
                    </span>
                  </div>
                </div>
                {trendPoints.length > 0 ? (
                  <LineChart
                    series={[
                      { name: "recall", color: "var(--accent)", data: trendPoints.map((p) => p.recall) },
                      { name: "precision", color: "var(--ok)", data: trendPoints.map((p) => p.precision) },
                      { name: "citation", color: "var(--warn)", data: trendPoints.map((p) => p.citation_accuracy) },
                    ]}
                    w={900}
                  />
                ) : (
                  <EmptyState icon="TrendingUp" title={t("dashboard.noRuns")} />
                )}
              </div>
            </>
          )}

          <div style={s.runsHeader}>
            <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
            <span style={s.selHint}>
              {selectedBatchIds.length === 2
                ? `2 selected`
                : `${selectedBatchIds.length} selected — pick exactly two to compare`}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <Button
                kind={selectedBatchIds.length === 2 ? "primary" : "ghost"}
                size="sm"
                disabled={selectedBatchIds.length !== 2}
                onClick={openCompare}
                title={selectedBatchIds.length === 2 ? undefined : "Select exactly two runs to compare"}
              >
                Compare
              </Button>
            </div>
          </div>

          {batches.isLoading ? (
            <Skeleton height={140} />
          ) : (batches.data ?? []).length === 0 ? (
            <EmptyState icon="History" title={t("dashboard.noRuns")} />
          ) : (
            <div style={s.table}>
              <div style={{ ...s.tableHead, gridTemplateColumns: TABLE_COLS_BATCHES }}>
                <div />
                <div>{t("dashboard.table.ranAt")}</div>
                <div>{t("dashboard.table.recall")}</div>
                <div>{t("dashboard.table.precision")}</div>
                <div>{t("dashboard.table.citation")}</div>
                <div>{t("dashboard.table.pass")}</div>
                <div>{t("dashboard.table.cost")}</div>
              </div>
              {(batches.data ?? []).map((b) => (
                <div key={b.batch_id} style={{ ...s.tableRow, gridTemplateColumns: TABLE_COLS_BATCHES }}>
                  <div style={s.checkboxCell}>
                    <Checkbox checked={selectedBatchIds.includes(b.batch_id)} onChange={() => toggleBatch(b.batch_id)} />
                  </div>
                  <span className="mono tnum">{fmtDate(b.ran_at)}</span>
                  <span className="tnum">{pct(b.recall)}</span>
                  {/* REC-2 per ROW: each batch carries its own flag. The
                      dashboard-level `alert` describes only the newest batch,
                      so it cannot annotate the older rows in this history. */}
                  <span className="tnum">{b.precision_undefined ? NOT_APPLICABLE : pct(b.precision)}</span>
                  <span className="tnum">{pct(b.citation_accuracy)}</span>
                  <span className="tnum">
                    {b.traces_passed}/{b.traces_total}
                  </span>
                  <span className="mono tnum">{formatCost(b.cost_usd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // ------------------------------------------------------------------------
  // Overview: every agent + a cross-agent recent-runs feed.
  // ------------------------------------------------------------------------
  const dash = workspace.data;
  const summaries = dash?.agents ?? [];
  const loading = agents.isLoading || workspace.isLoading;
  const noRuns = !loading && summaries.every((a) => a.last_ran_at == null);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
      <div style={s.headerRow}>
        <div>
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
        </div>
      </div>

      {loading ? (
        <Skeleton height={280} />
      ) : noRuns ? (
        <EmptyState icon="FlaskConical" title={t("dashboard.noRuns")} />
      ) : (
        <>
          <SectionLabel icon="Cpu">Agents</SectionLabel>
          <div style={s.agentList}>
            {summaries.map((a) => (
              <button key={a.agent_id} type="button" style={s.agentRow} onClick={() => openAgent(a.agent_id)}>
                <div style={s.agentIcon}>
                  <Icon.Cpu size={17} />
                </div>
                <div style={s.agentBody}>
                  <div style={s.agentName}>
                    <span style={{ fontSize: 14.5, fontWeight: 700 }}>{a.agent_name}</span>
                  </div>
                  <div style={s.agentMeta}>
                    {a.last_ran_at ? fmtDate(a.last_ran_at) : t("dashboard.noRuns")}
                  </div>
                </div>
                <div style={s.mini}>
                  <div style={s.miniLabel}>{t("dashboard.metrics.recall")}</div>
                  <div className="tnum" style={{ ...s.miniValue, color: "var(--accent)" }}>
                    {a.last_ran_at ? pct(a.current.recall) : "—"}
                  </div>
                </div>
                <div style={s.mini}>
                  <div style={s.miniLabel}>{t("dashboard.metrics.precision")}</div>
                  <div className="tnum" style={{ ...s.miniValue, color: "var(--ok)" }}>
                    {/* REC-2 per AGENT. `a.current.precision` is 1 whenever
                        nothing this agent produced landed on a labelled line,
                        and printing that as 100% credits an agent that has
                        demonstrated nothing. The workspace `alert` cannot stand
                        in: it is derived from the newest batch across ALL
                        agents. */}
                    {!a.last_ran_at ? "—" : a.precision_undefined ? NOT_APPLICABLE : pct(a.current.precision)}
                  </div>
                </div>
                <div style={s.mini}>
                  <div style={s.miniLabel}>{t("dashboard.metrics.citationAccuracy")}</div>
                  <div className="tnum" style={{ ...s.miniValue, color: "var(--warn)" }}>
                    {a.last_ran_at ? pct(a.current.citation_accuracy) : "—"}
                  </div>
                </div>
                <Badge color="var(--text-muted)">{a.cases_total}</Badge>
                <Icon.ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              </button>
            ))}
          </div>

          <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
          {(dash?.recent_runs ?? []).length === 0 ? (
            <EmptyState icon="History" title={t("dashboard.noRuns")} />
          ) : (
            <div style={s.table}>
              <div style={{ ...s.tableHead, gridTemplateColumns: TABLE_COLS_OVERVIEW }}>
                <div>Agent</div>
                <div>{t("dashboard.table.ranAt")}</div>
                <div>{t("dashboard.table.recall")}</div>
                <div>{t("dashboard.table.precision")}</div>
                <div>{t("dashboard.table.citation")}</div>
                <div>{t("dashboard.table.pass")}</div>
              </div>
              {(dash?.recent_runs ?? []).map((r) => {
                // REC-1: prefer the envelope's own agent snapshot; the row's
                // `agent_id`/`agent_name` are only the fallback for a run
                // whose envelope carries none.
                const name = envelopeAgentName(r.actual_output) ?? r.agent_name ?? "unknown agent";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openAgent(r.agent_id)}
                    style={{ ...s.tableRow, gridTemplateColumns: TABLE_COLS_OVERVIEW, cursor: "pointer", background: "transparent", border: "none", width: "100%", textAlign: "left" }}
                  >
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                    <span className="mono tnum">{fmtDate(r.ran_at)}</span>
                    <span className="tnum">{r.recall != null ? pct(r.recall) : "—"}</span>
                    <span className="tnum">{r.precision != null ? pct(r.precision) : "—"}</span>
                    <span className="tnum">{r.citation_accuracy != null ? pct(r.citation_accuracy) : "—"}</span>
                    <span className="tnum">{r.pass == null ? "—" : r.pass ? t("dashboard.pass") : t("dashboard.fail")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      </div>
    </AppShell>
  );
}
