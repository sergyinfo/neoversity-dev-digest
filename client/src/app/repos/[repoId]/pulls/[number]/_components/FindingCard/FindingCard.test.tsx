import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  explanation: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case (L06, AC-3)", () => {
  it("is disabled with a reason tooltip when the finding is unlabelled", () => {
    const onEvalCase = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onEvalCase={onEvalCase} />);
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Accept or dismiss this finding first — an unlabelled finding is not a data point.",
    );
    fireEvent.click(button);
    expect(onEvalCase).not.toHaveBeenCalled();
  });

  it("is enabled and invoked when the finding is accepted", () => {
    const onEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, accepted_at: "2026-08-01T00:00:00Z" }}
        defaultExpanded
        onEvalCase={onEvalCase}
      />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onEvalCase).toHaveBeenCalledTimes(1);
  });

  it("is enabled and invoked when the finding is dismissed", () => {
    const onEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, dismissed_at: "2026-08-01T00:00:00Z" }}
        defaultExpanded
        onEvalCase={onEvalCase}
      />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onEvalCase).toHaveBeenCalledTimes(1);
  });
});
