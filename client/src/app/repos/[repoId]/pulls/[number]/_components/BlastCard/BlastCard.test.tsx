import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../../messages/en/blast.json";
import type { BlastResponse } from "@/lib/hooks/blast";
import { BlastCard } from "./BlastCard";

/**
 * The three non-data states are the point of this suite. `degraded` (no usable
 * index → impact UNKNOWN) must never render like `empty` (indexed, genuinely
 * nothing downstream) — collapsing them would tell a reviewer the change is
 * safe exactly when we cannot know that.
 *
 * `fireEvent`, not `userEvent`: `@testing-library/user-event` is not installed
 * in this package (see client/INSIGHTS.md).
 */

const useBlast = vi.fn();
vi.mock("@/lib/hooks/blast", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useBlast: (...args: unknown[]) => useBlast(...args),
}));

afterEach(cleanup);
beforeEach(() => useBlast.mockReset());

const OK: BlastResponse = {
  pr_id: "p1",
  repo_full_name: "acme/app",
  head_sha: "head1111111",
  indexed_sha: "idx2222222",
  state: "ok",
  reason: null,
  counts: { symbols: 2, callers: 3, endpoints: 1, crons: 0 },
  map: {
    changed_symbols: [
      { name: "rateLimit", file: "src/mw/rate-limit.ts", kind: "function" },
      { name: "bucketKey", file: "src/mw/rate-limit.ts", kind: "function" },
    ],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [
          { name: "register", file: "src/api/public/index.ts", line: 23 },
          { name: "hook", file: "src/api/public/webhooks.ts", line: 45 },
        ],
        endpoints_affected: ["GET /api/public/items"],
        crons_affected: [],
      },
      {
        symbol: "bucketKey",
        callers: [{ name: "key", file: "src/mw/util.ts", line: 8 }],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
  },
  prior_prs: [
    {
      number: 41,
      title: "Earlier limiter tweak",
      author: "someone",
      updated_at: "2026-08-01T00:00:00.000Z",
      overlapping_files: ["src/mw/rate-limit.ts"],
    },
  ],
};

const state = (data: BlastResponse) => ({ data, isLoading: false, isError: false });

function renderCard(data: BlastResponse) {
  useBlast.mockReturnValue(state(data));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <div data-theme="dark">
          <BlastCard prId="p1" />
        </div>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BlastCard — counters and the tree", () => {
  it("renders the counters from `counts`", () => {
    renderCard(OK);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("symbols")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("endpoints")).toBeInTheDocument();
  });

  it("hides the cron counter at zero rather than asserting '0 cron'", () => {
    renderCard(OK);
    expect(screen.queryByText("cron/jobs")).not.toBeInTheDocument();
  });

  it("expands and collapses a symbol", () => {
    renderCard(OK);
    const row = screen.getByRole("button", { name: /rateLimit/ });
    expect(screen.queryByText(/src\/api\/public\/index\.ts:23/)).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByText(/src\/api\/public\/index\.ts:23/)).not.toBeInTheDocument();
  });
});

describe("BlastCard — file:line links (BD4)", () => {
  it("links a CALLER at the INDEXED sha, not the PR head", () => {
    renderCard(OK);
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));

    const link = screen.getByText("src/api/public/index.ts:23").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/app/blob/idx2222222/src/api/public/index.ts#L23",
    );
    expect(link?.getAttribute("href")).not.toContain("head1111111");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders plain text, not a wrong link, when nothing is indexed", () => {
    renderCard({ ...OK, indexed_sha: null });
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));

    const node = screen.getByText("src/api/public/index.ts:23");
    expect(node.closest("a")).toBeNull();
  });
});

describe("BlastCard — the three non-data states", () => {
  it("degraded says the impact is UNKNOWN and never shows the empty-state copy", () => {
    renderCard({
      ...OK,
      state: "degraded",
      reason: "no_data",
      counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      map: { changed_symbols: [], downstream: [] },
    });

    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/no_data/)).toBeInTheDocument();
    expect(screen.queryByText(/no downstream callers found/i)).not.toBeInTheDocument();
  });

  it("partial shows the data AND a caveat", () => {
    renderCard({ ...OK, state: "partial", reason: "3 file(s) were not indexed" });

    expect(screen.getByText(/incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rateLimit/ })).toBeInTheDocument();
  });

  it("empty is distinct: indexed, but genuinely nothing downstream", () => {
    renderCard({
      ...OK,
      counts: { symbols: 2, callers: 0, endpoints: 0, crons: 0 },
      map: { changed_symbols: OK.map.changed_symbols, downstream: [] },
    });

    expect(screen.getByText(/no downstream callers found/i)).toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });
});

describe("BlastCard — view toggle and prior PRs", () => {
  it("switches to the graph view and back", () => {
    renderCard(OK);
    const graphBtn = screen.getByRole("button", { name: "graph" });

    fireEvent.click(graphBtn);
    expect(screen.getByLabelText("Blast radius graph")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.queryByLabelText("Blast radius graph")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rateLimit/ })).toBeInTheDocument();
  });

  it("prior PRs are collapsed, expand on click, and absent when empty", () => {
    const { unmount } = renderCard(OK);
    expect(screen.queryByText("Earlier limiter tweak")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Prior PRs touching these files/ }));
    expect(screen.getByText(/Earlier limiter tweak/)).toBeInTheDocument();

    unmount();
    renderCard({ ...OK, prior_prs: [] });
    expect(
      screen.queryByRole("button", { name: /Prior PRs touching these files/ }),
    ).not.toBeInTheDocument();
  });
});
