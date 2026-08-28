import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentRecord } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import type { BriefResponse } from "@/lib/hooks/brief";
import { OverviewTab } from "./OverviewTab";

/**
 * The tab's contract is the ordering and the ISOLATION of its three cards: Why
 * & Risk owns its own query, so a brief that fails must not take the Intent and
 * Blast cards down with it.
 */

const usePrBrief = vi.fn();
const useBlast = vi.fn();
vi.mock("@/lib/hooks/brief", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  usePrBrief: (...args: unknown[]) => usePrBrief(...args),
  useGenerateBrief: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/blast", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useBlast: (...args: unknown[]) => useBlast(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  usePrBrief.mockReset();
  useBlast.mockReset();
  useBlast.mockReturnValue({ data: undefined, isLoading: false, isError: true });
});

const INTENT: PrIntentRecord = {
  pr_id: "p1",
  intent: "Add rate limiting to the public API endpoints.",
  in_scope: ["rate-limiting middleware"],
  out_of_scope: [],
  confidence: "medium",
  sources: ["pr_description"],
  head_sha: "a1b2c3d4",
  model: "deepseek/deepseek-v4-flash",
  derived_at: "2026-08-17T10:00:00.000Z",
};

const BRIEF: BriefResponse = {
  what: "Adds a token bucket in front of the public API routes.",
  why: "Scrapers exhausted the read replica twice last week.",
  risk_level: "medium",
  risks: [],
  review_focus: [],
  state_fingerprint: { local: "loc1", remote: "rem1" },
  inputs_used: ["intent", "blast", "diff"],
  references_used: [],
  references_skipped: [],
  discarded_refs: 0,
  blast_state: "ok",
  changed_files: { listed: 2, total: 2 },
  model: "deepseek/deepseek-v4-flash",
  cost_usd: 0.002,
  tokens_in: 100,
  tokens_out: 20,
  generated_at: "2026-08-27T10:00:00.000Z",
  out_of_date: false,
  moved_inputs: [],
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ brief: briefMessages, blast: blastMessages, prReview: prReviewMessages }}
      >
        <div data-theme="dark">
          <OverviewTab prId="p1" prBody="The description." intent={INTENT} />
        </div>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("OverviewTab", () => {
  it("renders Why & Risk ABOVE the Intent card", () => {
    usePrBrief.mockReturnValue({ data: BRIEF, isLoading: false, isError: false });
    renderTab();

    const why = screen.getByText("Why & Risk");
    const intent = screen.getByText("Intent");
    expect(why.compareDocumentPosition(intent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders all three cards", () => {
    usePrBrief.mockReturnValue({ data: BRIEF, isLoading: false, isError: false });
    renderTab();

    expect(screen.getByText("Why & Risk")).toBeInTheDocument();
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
    expect(screen.getByText("The description.")).toBeInTheDocument();
  });

  it("leaves the Intent and Blast cards rendered when the brief query FAILS", () => {
    usePrBrief.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderTab();

    expect(screen.getByText("Could not load the brief.")).toBeInTheDocument();
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText("“Add rate limiting to the public API endpoints.”")).toBeInTheDocument();
    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
  });

  it("leaves the other two cards rendered while the brief is still LOADING", () => {
    usePrBrief.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderTab();

    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
  });
});
