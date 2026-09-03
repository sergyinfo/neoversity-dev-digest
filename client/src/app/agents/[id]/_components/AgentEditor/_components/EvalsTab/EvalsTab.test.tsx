import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import type { EvalCase, EvalDashboard, EvalRunRecord } from "@/lib/types";

/**
 * EvalsTab (L06, S9) — CR-4: this is the suite `plan-verifier` gates on, not
 * just the tab-switch case in `AgentEditor.test.tsx`. `fireEvent`, not
 * `userEvent` (client/INSIGHTS.md — not installed). Hooks mocked at the
 * hook-function level, the house pattern (`RetroLedgerView.test.tsx`).
 */

const useEvalCases = vi.fn();
const useAgentEvalDashboard = vi.fn();
const useRunEvalSet = vi.fn();
const useDeleteEvalCase = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: (...args: unknown[]) => useEvalCases(...args),
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboard(...args),
  useRunEvalSet: (...args: unknown[]) => useRunEvalSet(...args),
  useDeleteEvalCase: (...args: unknown[]) => useDeleteEvalCase(...args),
}));

import { EvalsTab } from "./EvalsTab";

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

function evalCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: AGENT.id,
    name: "stripe-key-leak",
    input_diff: "--- a/x\n+++ b/x\n",
    input_files: null,
    input_meta: null,
    expected_output: {},
    notes: null,
    ...over,
  };
}

function runRecord(over: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "r1",
    case_id: "c1",
    case_name: "stripe-key-leak",
    ran_at: "2026-08-29T10:00:00.000Z",
    actual_output: {},
    pass: true,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    duration_ms: 1200,
    cost_usd: 0.02,
    ...over,
  };
}

function dashboard(over: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: AGENT.id,
    cases_total: 1,
    current: { recall: 0.8, precision: 0.9, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: 0.02 },
    delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
    ...over,
  };
}

function mock({
  cases,
  dash,
  casesLoading = false,
  dashLoading = false,
  runPending = false,
  deletePending = false,
  deleteVariables,
}: {
  cases?: EvalCase[];
  dash?: EvalDashboard;
  casesLoading?: boolean;
  dashLoading?: boolean;
  runPending?: boolean;
  deletePending?: boolean;
  deleteVariables?: string;
} = {}) {
  useEvalCases.mockReturnValue({ data: cases, isLoading: casesLoading });
  useAgentEvalDashboard.mockReturnValue({ data: dash, isLoading: dashLoading });
  useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: runPending, isError: false, error: undefined });
  useDeleteEvalCase.mockReturnValue({
    mutate: vi.fn(),
    isPending: deletePending,
    variables: deleteVariables,
    isError: false,
    error: undefined,
  });
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useEvalCases.mockReset();
  useAgentEvalDashboard.mockReset();
  useRunEvalSet.mockReset();
  useDeleteEvalCase.mockReset();
  mock();
});

describe("EvalsTab — empty state", () => {
  it("renders the empty-cases copy when there are no cases", () => {
    mock({ cases: [], dash: dashboard({ cases_total: 0 }) });
    renderTab();
    expect(
      screen.getByText(
        "No eval cases yet. Create one to assert this agent's expected findings on a sample diff.",
      ),
    ).toBeInTheDocument();
  });

  it("disables the run-all button when the set is empty", () => {
    mock({ cases: [], dash: dashboard({ cases_total: 0 }) });
    renderTab();
    expect(screen.getByRole("button", { name: /run eval/i })).toBeDisabled();
  });
});

describe("EvalsTab — populated case list", () => {
  it("shows a passed case with its recall", () => {
    mock({
      cases: [evalCase()],
      dash: dashboard({ recent_runs: [runRecord({ pass: true, recall: 0.8 })] }),
    });
    renderTab();
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText(/passed/)).toBeInTheDocument();
    expect(screen.getByText(/recall 80%/)).toBeInTheDocument();
  });

  it("shows a failed case distinctly from a passed one", () => {
    mock({
      cases: [evalCase({ id: "c2", name: "renamed-file-miss" })],
      dash: dashboard({ recent_runs: [runRecord({ case_id: "c2", pass: false, recall: 0.4 })] }),
    });
    renderTab();
    expect(screen.getByText(/failed/)).toBeInTheDocument();
  });

  it("shows 'never run' for a case with no run record", () => {
    mock({ cases: [evalCase({ id: "c3", name: "no-run-yet" })], dash: dashboard({ recent_runs: [] }) });
    renderTab();
    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("deletes a case when its Delete button is clicked", () => {
    const mutate = vi.fn();
    useEvalCases.mockReturnValue({ data: [evalCase()], isLoading: false });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard(), isLoading: false });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: undefined });
    useDeleteEvalCase.mockReturnValue({ mutate, isPending: false, variables: undefined, isError: false, error: undefined });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(mutate).toHaveBeenCalledWith("c1");
  });
});

describe("EvalsTab — metric cards with deltas", () => {
  it("renders recall/precision/citation with their percentages", () => {
    mock({ cases: [evalCase()], dash: dashboard() });
    renderTab();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders a delta value for a metric that moved", () => {
    mock({ cases: [evalCase()], dash: dashboard({ delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 } }) });
    renderTab();
    // MetricCard renders |delta| to 2dp — 0.10 for recall.
    expect(screen.getByText("0.10")).toBeInTheDocument();
  });
});

describe("EvalsTab — REC-2, precision 'n/a' when TP+FP=0", () => {
  it("renders 'n/a' instead of a percentage when the dashboard carries the alert", () => {
    mock({
      cases: [evalCase()],
      dash: dashboard({ alert: "No labelled findings were judged (TP+FP=0) — precision is not meaningful yet." }),
    });
    renderTab();
    expect(screen.getByText("n/a")).toBeInTheDocument();
    // Precision's own delta is meaningless alongside "n/a" and must not render.
    expect(screen.queryByText("0.05")).not.toBeInTheDocument();
  });

  it("renders a real percentage when there is no alert", () => {
    mock({ cases: [evalCase()], dash: dashboard({ alert: null }) });
    renderTab();
    expect(screen.queryByText("n/a")).not.toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
  });
});
