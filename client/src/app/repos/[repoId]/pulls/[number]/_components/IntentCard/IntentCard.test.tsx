import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const INTENT: PrIntentRecord = {
  pr_id: "p1",
  intent: "Add rate limiting to the public API endpoints.",
  in_scope: ["rate-limiting middleware", "public API routes"],
  out_of_scope: ["authentication"],
  confidence: "medium",
  sources: ["pr_description", "branch", "file_paths"],
  head_sha: "a1b2c3d4",
  model: "deepseek/deepseek-v4-flash",
  derived_at: "2026-08-17T10:00:00.000Z",
};

function renderCard(ui: React.ReactElement, theme: "dark" | "light" = "dark") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <div data-theme={theme}>{ui}</div>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("IntentCard", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders the intent, both scope lists and the confidence band in ${theme}`, () => {
      renderCard(<IntentCard prId="p1" intent={INTENT} />, theme);
      expect(
        screen.getByText("“Add rate limiting to the public API endpoints.”"),
      ).toBeInTheDocument();
      expect(screen.getByText("rate-limiting middleware")).toBeInTheDocument();
      expect(screen.getByText("authentication")).toBeInTheDocument();
      expect(screen.getByText("IN SCOPE")).toBeInTheDocument();
      expect(screen.getByText("OUT OF SCOPE")).toBeInTheDocument();
      expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    });
  });

  it("shows the confidence as a WORD, never a fabricated percentage", () => {
    renderCard(<IntentCard prId="p1" intent={INTENT} />);
    expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("lists the sources it was derived from, strongest first", () => {
    renderCard(
      <IntentCard
        prId="p1"
        intent={{ ...INTENT, sources: ["file_paths", "spec", "branch"] }}
      />,
    );
    const chips = ["plan / spec", "branch name", "changed files"].map((label) =>
      screen.getByText(label),
    );
    // Rendered in SOURCE_ORDER (spec → branch → file_paths), not input order.
    expect(chips[0]!.compareDocumentPosition(chips[1]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(chips[1]!.compareDocumentPosition(chips[2]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("falls back to the low band when confidence is absent (pre-Intent-Layer rows)", () => {
    renderCard(
      <IntentCard prId="p1" intent={{ ...INTENT, confidence: null, sources: null }} />,
    );
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(screen.queryByText("Derived from")).toBeNull();
  });

  it("marks an empty scope list rather than rendering nothing", () => {
    renderCard(<IntentCard prId="p1" intent={{ ...INTENT, out_of_scope: [] }} />);
    expect(screen.getByText("None listed.")).toBeInTheDocument();
  });

  it("offers a derive action when no intent exists", () => {
    renderCard(<IntentCard prId="p1" intent={null} />);
    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    expect(screen.getByText("Derive intent")).toBeInTheDocument();
    expect(screen.queryByText("IN SCOPE")).toBeNull();
  });

  it("shows a skeleton while the PR detail is loading", () => {
    const { container } = renderCard(<IntentCard prId="p1" intent={null} loading />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("No intent derived yet")).toBeNull();
  });

  it("POSTs a recompute when the button is clicked", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(INTENT), { status: 200 }));
    renderCard(<IntentCard prId="p1" intent={INTENT} />);
    fireEvent.click(screen.getByText("Recompute"));
    // react-query's mutate resolves on a microtask, so the request is not yet in
    // flight on the synchronous line after the click.
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/p1/intent"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    fetchSpy.mockRestore();
  });
});
