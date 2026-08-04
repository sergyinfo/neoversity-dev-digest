/**
 * PRRow — the findings cell on the PR LIST.
 *
 * The list ships three integers per row and fetches the findings themselves only
 * when someone opens the card. These tests pin both halves of that bargain: the
 * badges render from the row payload alone, and nothing is requested until the
 * card opens.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null | undefined, enabled?: boolean) =>
    usePrReviews(prId, enabled),
}));

import { PRRow } from "./PRRow";

afterEach(() => {
  cleanup();
  push.mockReset();
  usePrReviews.mockReset();
});

const PR: PrMeta = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiter",
  author: "marisa.koch",
  branch: "feat/rl",
  base: "main",
  head_sha: "abc1234",
  additions: 120,
  deletions: 10,
  files_count: 4,
  status: "needs_review",
  opened_at: "2026-06-10T10:00:00.000Z",
  updated_at: "2026-06-11T10:00:00.000Z",
  score: 38,
  cost_usd: 0.0013,
  findings_by_severity: { CRITICAL: 2, WARNING: 1, SUGGESTION: 0 },
};

function renderRow(pr: PrMeta = PR) {
  usePrReviews.mockReturnValue({ data: undefined });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={pr} repoId="repo-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PRRow — findings cell", () => {
  it("renders the severity counts that came with the row", () => {
    renderRow();
    expect(
      screen.getByRole("button", { name: /3 findings on #482: 2 critical, 1 warning/i }),
    ).toBeInTheDocument();
  });

  it("a PR that has never been reviewed shows a dash, not zeros", () => {
    renderRow({ ...PR, score: null, findings_by_severity: null });
    expect(screen.queryByRole("button", { name: /findings on/i })).not.toBeInTheDocument();
  });

  it("does not fetch findings until the card is opened", () => {
    renderRow();
    expect(usePrReviews).toHaveBeenLastCalledWith("pr-1", false);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /findings on/i }));
    expect(usePrReviews).toHaveBeenLastCalledWith("pr-1", true);
  });

  it("opening the findings card does not navigate to the PR", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: /findings on/i }));
    expect(push).not.toHaveBeenCalled();
  });

  it("clicking the row itself still opens the PR", () => {
    renderRow();
    fireEvent.click(screen.getByText("Add rate limiter"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });
});
