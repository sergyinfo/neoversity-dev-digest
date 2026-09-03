/* CR-3 (cross-model review, eval-pipeline plan): the plan's own Done-when for
   S8 only asserts the button renders enabled/disabled, which would pass while
   a prop-threading bug between FindingCard → FindingsPanel → ReviewRunAccordion
   left case creation completely broken. This test renders the real
   ReviewRunAccordion → FindingsPanel → FindingCard chain (nothing stubbed
   between them) and asserts pressing the button invokes the mutation with the
   right arguments — the wiring, not just the leaf component's own props. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutate, isPending: false }),
}));

vi.mock("../../../../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

const REVIEW: ReviewRecord = {
  id: "rev1",
  pr_id: "pr1",
  agent_id: "agent-123",
  run_id: "run1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: null,
  summary: null,
  score: null,
  model: null,
  grounding: null,
  created_at: "2026-08-01T00:00:00Z",
  findings: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
      file: "src/config.ts",
      start_line: 11,
      end_line: 11,
      explanation: "A live Stripe key is committed in source.",
      suggestion: null,
      confidence: 0.95,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rev1",
      // Accepted, so the "Turn into eval case" button is enabled (AC-3).
      accepted_at: "2026-08-01T00:00:00Z",
      dismissed_at: null,
    },
  ],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ReviewRunAccordion — wires 'Turn into eval case' end to end (CR-3)", () => {
  it("presses through FindingsPanel → FindingCard and invokes useCreateEvalCase's mutate with {findingId, agentId: review.agent_id}", () => {
    renderWithIntl(<ReviewRunAccordion review={REVIEW} prId="pr1" defaultOpen />);

    fireEvent.click(screen.getByText("Turn into eval case"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { findingId: "f1", agentId: "agent-123" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("passes null when the review has no agent attributed (BQ-2a body fallback)", () => {
    renderWithIntl(
      <ReviewRunAccordion review={{ ...REVIEW, agent_id: null }} prId="pr1" defaultOpen />,
    );

    fireEvent.click(screen.getByText("Turn into eval case"));

    expect(mutate).toHaveBeenCalledWith(
      { findingId: "f1", agentId: null },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
