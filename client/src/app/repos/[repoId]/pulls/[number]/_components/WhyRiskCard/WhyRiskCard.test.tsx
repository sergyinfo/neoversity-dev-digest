import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../../messages/en/brief.json";
import type { BriefResponse } from "@/lib/hooks/brief";
import { WhyRiskCard } from "./WhyRiskCard";
import { formatGeneratedAt } from "./constants";

/**
 * The load-bearing behaviours here are the ones that would quietly mislead a
 * reviewer if they broke: the risk level must read as a WORD (colour alone
 * fails WCAG AA and is invisible in a screenshot), an empty focus list must
 * stay empty rather than have a changed file substituted in, and regenerate
 * must be reachable on a brief that reads as current — `out_of_date` only sees
 * the LOCAL half of the fingerprint.
 *
 * `fireEvent`, not `userEvent`: `@testing-library/user-event` is not installed
 * in this package (see client/INSIGHTS.md).
 */

const usePrBrief = vi.fn();
const mutate = vi.fn();
vi.mock("@/lib/hooks/brief", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  usePrBrief: (...args: unknown[]) => usePrBrief(...args),
  useGenerateBrief: () => ({ mutate, isPending: false }),
}));

afterEach(cleanup);
beforeEach(() => {
  usePrBrief.mockReset();
  mutate.mockReset();
});

const BRIEF: BriefResponse = {
  what: "Adds a token bucket in front of the public API routes.",
  why: "Scrapers exhausted the read replica twice last week.",
  risk_level: "high",
  risks: [
    {
      kind: "regression",
      title: "Legitimate clients may be throttled",
      explanation: "The bucket is keyed by IP, so anyone behind a NAT shares a quota.",
      severity: "high",
      file_refs: ["src/mw/rate-limit.ts:31"],
    },
    {
      kind: "operability",
      title: "No metric for rejected requests",
      explanation: "A 429 spike would be invisible until users report it.",
      severity: "low",
      file_refs: [],
    },
  ],
  review_focus: [
    { file: "src/mw/rate-limit.ts", line: 42, reason: "the bucket refill maths" },
    { file: "src/api/public/index.ts", line: null, reason: "where the middleware is mounted" },
  ],
  state_fingerprint: { local: "loc1", remote: "rem1" },
  inputs_used: ["intent", "blast", "diff"],
  references_used: [],
  references_skipped: [],
  discarded_refs: 0,
  model: "deepseek/deepseek-v4-flash",
  cost_usd: 0.0013,
  tokens_in: 4821,
  tokens_out: 640,
  generated_at: "2026-08-27T10:00:00.000Z",
  out_of_date: false,
  moved_inputs: [],
};

type QueryState = { data: BriefResponse | null; isLoading: boolean; isError: boolean };

function renderCard(
  state: Partial<QueryState>,
  onOpenFile?: (path: string, line?: number) => void,
) {
  usePrBrief.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
    ...state,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <div data-theme="dark">
          <WhyRiskCard prId="p1" onOpenFile={onOpenFile} />
        </div>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("WhyRiskCard — a rendered brief", () => {
  it("renders the card label, both prose blocks, the risks and the focus list", () => {
    renderCard({ data: BRIEF });

    expect(screen.getByText("Why & Risk")).toBeInTheDocument();
    expect(screen.getByText("What")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText("Why")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.why)).toBeInTheDocument();

    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("Legitimate clients may be throttled")).toBeInTheDocument();
    expect(screen.getByText("No metric for rejected requests")).toBeInTheDocument();
    expect(screen.queryByText("No notable risks flagged.")).toBeNull();

    expect(screen.getByText("Review focus")).toBeInTheDocument();
    expect(screen.getByText("— the bucket refill maths")).toBeInTheDocument();
    expect(screen.getByText("— where the middleware is mounted")).toBeInTheDocument();
  });

  it("shows the risk level as a WORD, not as colour alone", () => {
    renderCard({ data: BRIEF });
    expect(screen.getByText("Risk level")).toBeInTheDocument();
    // "High" for the overall level and for the first risk's own severity.
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("announces a focus entry by file, line AND reason, and jumps on click", () => {
    const onOpenFile = vi.fn();
    renderCard({ data: BRIEF }, onOpenFile);

    const btn = screen.getByRole("button", {
      name: "src/mw/rate-limit.ts:42 — the bucket refill maths",
    });
    fireEvent.click(btn);
    expect(onOpenFile).toHaveBeenCalledWith("src/mw/rate-limit.ts", 42);
  });

  it("opens a focus entry that has no line without a line, and does not throw", () => {
    const onOpenFile = vi.fn();
    renderCard({ data: BRIEF }, onOpenFile);

    const btn = screen.getByRole("button", {
      name: "src/api/public/index.ts — where the middleware is mounted",
    });
    expect(() => fireEvent.click(btn)).not.toThrow();
    expect(onOpenFile).toHaveBeenCalledWith("src/api/public/index.ts", undefined);
  });

  it("opens a risk's file reference at its line", () => {
    const onOpenFile = vi.fn();
    renderCard({ data: BRIEF }, onOpenFile);

    fireEvent.click(screen.getByRole("button", { name: "src/mw/rate-limit.ts:31" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/mw/rate-limit.ts", 31);
  });

  it("keeps the full path available on hover when it is middle-truncated", () => {
    const long = "src/modules/notifications/delivery/providers/webhook-dispatcher.ts";
    renderCard({
      data: {
        ...BRIEF,
        review_focus: [{ file: long, line: 118, reason: "retry backoff" }],
      },
    });

    const truncated = document.querySelector(`[title="${long}:118"]`);
    expect(truncated).not.toBeNull();
    expect(truncated!.textContent).toContain("…");
    // The accessible name still carries the real target, not the ellipsis.
    expect(
      screen.getByRole("button", { name: `${long}:118 — retry backoff` }),
    ).toBeInTheDocument();
  });

  it("offers regenerate on a brief that reads as CURRENT", () => {
    renderCard({ data: BRIEF });
    expect(screen.queryByText("May be out of date", { exact: false })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    expect(mutate).toHaveBeenCalledWith({ regenerate: true });
  });

  it("renders the model, the cost and tokens in → out", () => {
    renderCard({ data: BRIEF });
    expect(screen.getByText("deepseek/deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
    expect(screen.getByText("4821 → 640")).toBeInTheDocument();
  });

  /**
   * `generated_at` is load-bearing, not decorative. Under D-1a an edited linked
   * issue or reference document moves only the REMOTE half of the state
   * fingerprint, which the read path never recomputes — so the card shows such
   * a brief as CURRENT, and spec §10/F-9 make this timestamp plus the
   * provenance list the only two things that date it. A relative phrase would
   * assert exactly the freshness we cannot check.
   */
  describe("generated_at", () => {
    it("renders the timestamp, as an absolute date and never a relative phrase", () => {
      const { container } = renderCard({ data: BRIEF });

      // Compared against the same locale formatting the card uses, so the
      // assertion does not depend on the machine's timezone.
      const when = new Date(BRIEF.generated_at).toLocaleString();
      expect(screen.getByText(`Generated ${when}`)).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/just now|ago|moments/i);
      // The exact ISO value stays available on hover.
      expect(document.querySelector(`[title="${BRIEF.generated_at}"]`)).not.toBeNull();
    });

    it("renders an em dash when there is no timestamp, never an Invalid Date", () => {
      const { container } = renderCard({ data: { ...BRIEF, generated_at: "" } });

      expect(screen.getByText("Generated —")).toBeInTheDocument();
      expect(container.textContent).not.toContain("Invalid Date");
      expect(container.textContent).not.toMatch(/just now|ago|moments/i);
    });

    it("formatGeneratedAt maps every missing or unusable value to an em dash", () => {
      expect(formatGeneratedAt(null)).toBe("—");
      expect(formatGeneratedAt(undefined)).toBe("—");
      expect(formatGeneratedAt("")).toBe("—");
      expect(formatGeneratedAt("not a date")).toBe("—");
      expect(formatGeneratedAt("2026-08-27T10:00:00.000Z")).toBe(
        new Date("2026-08-27T10:00:00.000Z").toLocaleString(),
      );
    });
  });

  it("keys duplicated file_refs uniquely, so React does not collide them", () => {
    // Nothing dedupes `file_refs`: the contract is a bare `z.array(z.string())`
    // and server-side grounding only filters it, so the same path twice is a
    // shape the card must render. A bare `key={ref}` warns and reconciles the
    // two entries as one.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderCard({
        data: {
          ...BRIEF,
          risks: [{ ...BRIEF.risks[0]!, file_refs: ["src/mw/rate-limit.ts:31", "src/mw/rate-limit.ts:31"] }],
        },
      });

      expect(
        screen.getAllByRole("button", { name: "src/mw/rate-limit.ts:31" }),
      ).toHaveLength(2);
      const warnings = spy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(warnings).not.toMatch(/same key/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("says so when there are no risks rather than rendering an empty block", () => {
    renderCard({ data: { ...BRIEF, risks: [] } });
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });
});

describe("WhyRiskCard — focus that grounding discarded", () => {
  it("shows the empty-focus state and substitutes NO changed file", () => {
    const { container } = renderCard({
      data: { ...BRIEF, review_focus: [], risks: [], discarded_refs: 3 },
    });

    expect(screen.getByText("Nothing specific flagged to review first.")).toBeInTheDocument();
    expect(
      screen.getByText("3 reference(s) dropped — not in this PR's changed files."),
    ).toBeInTheDocument();
    // Not one file reference is offered: every mono link in this card is a
    // file, so an invented "read this instead" would show up here.
    expect(container.querySelectorAll("button.mono")).toHaveLength(0);
  });
});

describe("WhyRiskCard — out of date", () => {
  const STALE: BriefResponse = {
    ...BRIEF,
    out_of_date: true,
    moved_inputs: ["head_sha"],
  };

  it("names the input that moved, keeps the content readable and still offers regenerate", () => {
    renderCard({ data: STALE });

    expect(screen.getByText(/May be out of date/)).toBeInTheDocument();
    expect(
      screen.getByText(/the PR head commit changed since this brief was generated\./),
    ).toBeInTheDocument();
    // Stale is not hidden: what/why/risks are still on screen.
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText("Legitimate clients may be throttled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    expect(mutate).toHaveBeenCalledWith({ regenerate: true });
  });
});

describe("WhyRiskCard — non-data states", () => {
  it("offers a generate control when no brief is stored, and calls nothing on mount", () => {
    renderCard({ data: null });

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Generate a brief to see what this PR changes, why, and what to review first.",
      ),
    ).toBeInTheDocument();
    // A model call must never fire from a render — only from a gesture.
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Generate brief/ }));
    expect(mutate).toHaveBeenCalledWith({});
  });

  it("shows a skeleton while the brief is loading", () => {
    const { container } = renderCard({ isLoading: true });
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Brief not available yet.")).toBeNull();
  });

  it("reports a read failure instead of pretending there is no brief", () => {
    renderCard({ isError: true });
    expect(screen.getByText("Could not load the brief.")).toBeInTheDocument();
    expect(screen.queryByText("Brief not available yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate brief/ })).toBeNull();
  });
});
