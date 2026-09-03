import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../../../messages/en/eval.json";
import type { Agent } from "@devdigest/shared";
import type { EvalBatchSummary } from "@/lib/hooks/evals";

/**
 * EvalDashboardView (L06, S10 + S11) — the `/eval` overview + per-agent
 * drill-down + Compare selection. `fireEvent`, not `userEvent`
 * (client/INSIGHTS.md). Hooks mocked at the hook-function level (house
 * pattern — `ProjectContextView.test.tsx`).
 */

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const useAgents = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => useAgents(...args),
}));

const useAgentEvalDashboard = vi.fn();
const useEvalBatches = vi.fn();
const useWorkspaceEvalDashboard = vi.fn();
vi.mock("@/lib/hooks/evals", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboard(...args),
  useEvalBatches: (...args: unknown[]) => useEvalBatches(...args),
  useWorkspaceEvalDashboard: (...args: unknown[]) => useWorkspaceEvalDashboard(...args),
}));

// The compare MODAL itself is covered by CompareModal.test.tsx; here it is a
// stand-in so this suite stays about selection, not prompt-diff rendering.
vi.mock("../CompareModal", () => ({
  CompareModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="compare-modal">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function batch(over: Partial<EvalBatchSummary> = {}): EvalBatchSummary {
  return {
    batch_id: "b1",
    ran_at: "2026-08-29T10:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    traces_passed: 8,
    traces_total: 10,
    cost_usd: 0.1,
    agent: {
      id: AGENT.id,
      name: AGENT.name,
      system_prompt: AGENT.system_prompt,
      model: AGENT.model,
      skills: [],
    },
    precision_undefined: false,
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useAgents.mockReset();
  useAgentEvalDashboard.mockReset();
  useEvalBatches.mockReset();
  useWorkspaceEvalDashboard.mockReset();

  useAgents.mockReturnValue({ data: [AGENT], isLoading: false });
  useAgentEvalDashboard.mockReturnValue({ data: undefined, isLoading: false });
  useEvalBatches.mockReturnValue({ data: [], isLoading: false });
  useWorkspaceEvalDashboard.mockReturnValue({
    data: {
      owner_kind: null,
      owner_id: null,
      cases_total: 8,
      current: { recall: 0.8, precision: 0.9, citation_accuracy: 1, traces_passed: 8, traces_total: 10, cost_usd: 0.1 },
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
      trend: [],
      recent_runs: [],
      alert: null,
      agents: [
        {
          agent_id: AGENT.id,
          agent_name: AGENT.name,
          cases_total: 8,
          current: { recall: 0.8, precision: 0.9, citation_accuracy: 1, traces_passed: 8, traces_total: 10, cost_usd: 0.1 },
          delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 },
          last_ran_at: "2026-08-29T10:00:00.000Z",
          precision_undefined: false,
        },
      ],
    },
    isLoading: false,
  });
});

describe("EvalDashboardView — overview empty state", () => {
  it("renders the no-runs copy when no agent has ever run", () => {
    useWorkspaceEvalDashboard.mockReturnValue({
      data: {
        owner_kind: null,
        owner_id: null,
        cases_total: 0,
        current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null },
        delta: { recall: 0, precision: 0, citation_accuracy: 0 },
        trend: [],
        recent_runs: [],
        alert: null,
        agents: [{ agent_id: AGENT.id, agent_name: AGENT.name, cases_total: 0, current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null }, delta: { recall: 0, precision: 0, citation_accuracy: 0 }, last_ran_at: null, precision_undefined: true }],
      },
      isLoading: false,
    });
    renderView();
    expect(screen.getByText("No runs yet. Create an eval case and run it.")).toBeInTheDocument();
  });
});

describe("EvalDashboardView — populated agent list", () => {
  it("lists the agent with its latest metrics", () => {
    renderView();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("drills into the agent's own batch history on click", () => {
    useEvalBatches.mockReturnValue({ data: [batch()], isLoading: false });
    renderView();
    fireEvent.click(screen.getByText("Security Reviewer"));
    // Now in the drill-down: the agent's own header renders.
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
  });
});

describe("EvalDashboardView — Compare selection (S11, AC-18/AC-19)", () => {
  function openDrillDown(batches: EvalBatchSummary[]) {
    useEvalBatches.mockReturnValue({ data: batches, isLoading: false });
    renderView();
    fireEvent.click(screen.getByText("Security Reviewer"));
  }

  it("disables Compare at zero selections", () => {
    openDrillDown([batch({ batch_id: "b1" }), batch({ batch_id: "b2" }), batch({ batch_id: "b3" })]);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  it("disables Compare at one selection", () => {
    openDrillDown([batch({ batch_id: "b1" }), batch({ batch_id: "b2" }), batch({ batch_id: "b3" })]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  it("enables Compare at exactly two selections", () => {
    openDrillDown([batch({ batch_id: "b1" }), batch({ batch_id: "b2" }), batch({ batch_id: "b3" })]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();
  });

  it("disables Compare again at three selections", () => {
    openDrillDown([batch({ batch_id: "b1" }), batch({ batch_id: "b2" }), batch({ batch_id: "b3" })]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getAllByRole("checkbox")[2]!);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  it("opens the compare modal only when exactly two are selected", () => {
    openDrillDown([batch({ batch_id: "b1" }), batch({ batch_id: "b2" })]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByTestId("compare-modal")).toBeInTheDocument();
  });
});

describe("EvalDashboardView — REC-2, a vacuous precision is never 100% (fix brief F3)", () => {
  /** The workspace dashboard, with one agent whose flag the test controls. */
  function workspaceWith(precisionUndefined: boolean) {
    const current = {
      recall: 0.8,
      // 1 by the scorer's `TP + FP = 0` rule — indistinguishable from a real
      // perfect score without the flag beside it. This is the whole finding.
      precision: 1,
      // Not 1: it would render its own "100%" and blunt the assertions below,
      // which are about precision and nothing else.
      citation_accuracy: 0.95,
      traces_passed: 8,
      traces_total: 10,
      cost_usd: 0.1,
    };
    useWorkspaceEvalDashboard.mockReturnValue({
      data: {
        owner_kind: null,
        owner_id: null,
        cases_total: 8,
        current,
        delta: { recall: 0, precision: 0, citation_accuracy: 0 },
        trend: [],
        recent_runs: [],
        // Deliberately null: `alert` describes the newest batch across ALL
        // agents, so the per-agent row may not lean on it.
        alert: null,
        agents: [
          {
            agent_id: AGENT.id,
            agent_name: AGENT.name,
            cases_total: 8,
            current,
            delta: { recall: 0, precision: 0, citation_accuracy: 0 },
            last_ran_at: "2026-08-29T10:00:00.000Z",
            precision_undefined: precisionUndefined,
          },
        ],
      },
      isLoading: false,
    });
  }

  it("renders n/a, not 100%, in the overview row for an agent with no labelled findings", () => {
    workspaceWith(true);
    renderView();

    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    // Recall is unaffected — only precision is the vacuous one.
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("still renders a real 100% when the agent did land on labelled lines", () => {
    workspaceWith(false);
    renderView();

    expect(screen.getAllByText("100%")).toHaveLength(1);
    expect(screen.queryByText("n/a")).not.toBeInTheDocument();
  });

  it("renders n/a per ROW in the batch history, so an old batch keeps its own verdict", () => {
    useEvalBatches.mockReturnValue({
      data: [
        // `citation_accuracy` is off 1 on purpose: it renders in the same table
        // and a 100% there would be indistinguishable from the precision cell.
        batch({ batch_id: "b-new", precision: 1, citation_accuracy: 0.9, precision_undefined: true }),
        batch({ batch_id: "b-old", precision: 1, citation_accuracy: 0.9, precision_undefined: false }),
      ],
      isLoading: false,
    });
    renderView();
    fireEvent.click(screen.getByText("Security Reviewer"));

    // One row measured nothing and one measured a perfect score. Before the fix
    // both printed "100%"; the workspace `alert` could not tell them apart
    // because it is derived from the newest batch only.
    expect(screen.getAllByText("n/a")).toHaveLength(1);
    expect(screen.getAllByText("100%")).toHaveLength(1);
  });
});
