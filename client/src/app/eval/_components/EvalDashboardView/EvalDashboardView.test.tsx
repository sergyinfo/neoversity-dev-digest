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
        agents: [{ agent_id: AGENT.id, agent_name: AGENT.name, cases_total: 0, current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null }, delta: { recall: 0, precision: 0, citation_accuracy: 0 }, last_ran_at: null }],
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
