import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & { id: string; title: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "security",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    explanation: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

// 1 CRITICAL · 2 WARNING (one low-confidence) · 0 SUGGESTION.
const FINDINGS: FindingRecord[] = [
  finding({ id: "f1", title: "Hardcoded secret", severity: "CRITICAL" }),
  finding({ id: "f2", title: "Missing await", severity: "WARNING" }),
  finding({ id: "f3", title: "Shaky heuristic", severity: "WARNING", confidence: 0.4 }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** The severity chip is the button whose accessible name starts with the level. */
function chip(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}`, "i") });
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel severity counters", () => {
  it("renders a chip per severity with its count, zeros included", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(within(chip("Critical")).getByText("1")).toBeInTheDocument();
    expect(within(chip("Warning")).getByText("2")).toBeInTheDocument();
    expect(within(chip("Suggestion")).getByText("0")).toBeInTheDocument();
  });

  it("shows only that level's findings when a chip is clicked", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    fireEvent.click(chip("Critical"));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Missing await")).not.toBeInTheDocument();
    expect(screen.queryByText("Shaky heuristic")).not.toBeInTheDocument();
  });

  it("clears the filter when the active chip is clicked again", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    fireEvent.click(chip("Critical"));
    fireEvent.click(chip("Critical"));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Missing await")).toBeInTheDocument();
  });

  it("switches directly from one level to another", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    fireEvent.click(chip("Critical"));
    fireEvent.click(chip("Warning"));

    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("Missing await")).toBeInTheDocument();
  });

  it("shows the empty state for a level with no findings", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    fireEvent.click(chip("Suggestion"));

    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("keeps counts in step with the list when hiding low confidence", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    // The low-confidence WARNING drops out of both the count and the list.
    fireEvent.click(screen.getByRole("switch"));

    expect(within(chip("Warning")).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("Shaky heuristic")).not.toBeInTheDocument();
    expect(screen.getByText("Missing await")).toBeInTheDocument();
  });
});
