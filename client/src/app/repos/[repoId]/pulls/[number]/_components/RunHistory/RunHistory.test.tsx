/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRun?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret committed",
    rationale: "A literal key is committed.",
    suggestion: null,
    confidence: 0.97,
    kind: "finding",
    ...o,
  } as FindingRecord;
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("a settled run shows total tokens · cost; a missing cost shows '—' not '$0.00'", () => {
    renderRuns([
      run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013, score: 80 }),
    ]);
    expect(screen.getByText(/9,119 tok · \$0\.0013/)).toBeInTheDocument();

    cleanup();
    renderRuns([run({ status: "done", tokens_in: 0, tokens_out: 0, cost_usd: null, score: 80 })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — severity badges + findings preview", () => {
  const runId = "run-1";

  it("replaces the findings sentence with per-severity badges", () => {
    renderRuns(
      [run({ run_id: runId, status: "done", findings_count: 3, blockers: 1, score: 40 })],
      new Map([
        [
          runId,
          [
            finding({ id: "f1", severity: "CRITICAL" }),
            finding({ id: "f2", severity: "WARNING" }),
            finding({ id: "f3", severity: "WARNING" }),
          ],
        ],
      ]),
    );
    expect(screen.queryByText(/3 finding/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /3 findings on Security Reviewer: 1 critical, 2 warning/i }),
    ).toBeInTheDocument();
  });

  it("hovering a run opens its findings, and only its own", () => {
    renderRuns(
      [
        run({ run_id: "run-1", status: "done", findings_count: 1, blockers: 0, score: 70 }),
        run({ run_id: "run-2", status: "done", findings_count: 1, blockers: 0, score: 70 }),
      ],
      new Map([
        ["run-1", [finding({ id: "f1", title: "Belongs to run one" })]],
        ["run-2", [finding({ id: "f2", title: "Belongs to run two" })]],
      ]),
    );
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: /findings on/i })[0]!);
    expect(screen.getByText("Belongs to run one")).toBeInTheDocument();
    expect(screen.queryByText("Belongs to run two")).not.toBeInTheDocument();
  });

  it("badges come from the findings themselves, so they cannot contradict the popup", () => {
    // findings_count says 9; the actual findings say 1. The badge follows the
    // findings, because that is what the popup will show.
    renderRuns(
      [run({ run_id: runId, status: "done", findings_count: 9, blockers: 0, score: 70 })],
      new Map([[runId, [finding({ id: "f1", severity: "SUGGESTION" })]]]),
    );
    expect(screen.getByRole("button", { name: /^1 findings/i })).toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("falls back to the plain sentence when the findings have not been supplied", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText(/3 finding/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /findings on/i })).not.toBeInTheDocument();
  });
});
