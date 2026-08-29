import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import retroMessages from "../../../../../messages/en/retro.json";
import type { RetroLedger } from "@/lib/hooks/retro";

/**
 * `/retro` — the read-only ledger viewer.
 *
 * `fireEvent`, not `userEvent`: `@testing-library/user-event` is not installed
 * in this package (client/INSIGHTS.md). The data hook is mocked at the
 * hook-function level, the house pattern used by `ProjectContextView.test.tsx`.
 *
 * The empty state gets the most attention here on purpose: the committed
 * ledger has zero entries today, so it is the state anyone actually opens.
 */

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const useRetroLedger = vi.fn();
vi.mock("@/lib/hooks/retro", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRetroLedger: (...args: unknown[]) => useRetroLedger(...args),
}));

import { RetroLedgerView } from "./RetroLedgerView";

afterEach(cleanup);

/** The real ledger's shape: header, scope note, marker, nothing after it. */
const PREAMBLE_ONLY = [
  "# Retro ledger",
  "",
  "Retrospectives on **how the SDD pipeline performed**.",
  "",
  "---",
  "",
  "<!-- entries below, newest first -->",
].join("\n");

const WITH_ENTRY = `${PREAMBLE_ONLY}\n\n## 2026-08-29 — L05 Project Context\n\nThe plan's S7 was wrong about the emit path.\n`;

function ledger(over: Partial<RetroLedger> = {}): RetroLedger {
  return {
    content: PREAMBLE_ONLY,
    updated_at: "2026-08-29T12:03:00.000Z",
    exists: true,
    path: "docs/retro/ledger.md",
    ...over,
  };
}

function mockLedger(data: RetroLedger | undefined, over: Record<string, unknown> = {}) {
  useRetroLedger.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  });
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ retro: retroMessages }}>
      <RetroLedgerView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useRetroLedger.mockReset();
  mockLedger(ledger());
});

describe("RetroLedgerView — rendering the markdown", () => {
  it("renders the ledger's markdown rather than its raw source", () => {
    mockLedger(ledger({ content: WITH_ENTRY }));
    renderPage();

    // A heading became a heading — i.e. it went through the Markdown renderer.
    expect(
      screen.getByRole("heading", { name: "2026-08-29 — L05 Project Context" }),
    ).toBeInTheDocument();
    // Two "Retro ledger" headings, and that is correct: the page's own chrome
    // title, plus the file's own `# Retro ledger`. The file is rendered
    // VERBATIM, so its title is not stripped to avoid the repetition.
    expect(screen.getAllByRole("heading", { name: "Retro ledger" })).toHaveLength(2);
    // `**how the SDD pipeline performed**` rendered as emphasis, not asterisks.
    expect(screen.getByText("how the SDD pipeline performed")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*how the SDD pipeline performed\*\*/)).not.toBeInTheDocument();
    // The HTML comment marker is never shown to the reader.
    expect(screen.queryByText(/entries below, newest first/)).not.toBeInTheDocument();
  });

  it("shows the file's last-changed time as a FILE timestamp, never as an entry date", () => {
    mockLedger(ledger({ content: WITH_ENTRY }));
    renderPage();
    expect(screen.getByText(/^File last changed/)).toBeInTheDocument();
  });

  it("names the file it is reading", () => {
    renderPage();
    expect(screen.getByText("Reading docs/retro/ledger.md")).toBeInTheDocument();
  });

  it("does not offer any way to run or write a retro", () => {
    mockLedger(ledger({ content: WITH_ENTRY }));
    renderPage();
    // Read-only by design: `/retro` is typed by a human, and this page has no
    // write path. A button appearing here would be the regression.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("RetroLedgerView — the empty state (zero entries, the state on disk today)", () => {
  it("says nothing has been recorded yet, and why nothing runs on its own", () => {
    renderPage();

    expect(screen.getByText("No retrospectives recorded yet")).toBeInTheDocument();
    expect(screen.getByText(/runs only when a human types it/)).toBeInTheDocument();
    expect(screen.getByText(/nothing in DevDigest starts one/)).toBeInTheDocument();
  });

  it("still renders the file's real preamble — the empty state adds to it, never replaces it", () => {
    renderPage();
    // Do not fake content, and do not throw away the genuine content there is:
    // the file's prose is rendered under the empty state, not instead of it.
    // (Asserted on the file's own emphasised phrase, which no page chrome copy
    // repeats — the `# Retro ledger` heading collides with the page title.)
    expect(screen.getByText("how the SDD pipeline performed")).toBeInTheDocument();
  });

  it("disappears as soon as there is an entry", () => {
    mockLedger(ledger({ content: WITH_ENTRY }));
    renderPage();
    expect(screen.queryByText("No retrospectives recorded yet")).not.toBeInTheDocument();
  });

  it("distinguishes 'no ledger file' from 'a ledger with no entries'", () => {
    mockLedger(ledger({ exists: false, content: "", updated_at: null }));
    renderPage();

    expect(screen.getByText("No ledger yet")).toBeInTheDocument();
    expect(screen.queryByText("No retrospectives recorded yet")).not.toBeInTheDocument();
    // The two bodies must not share copy: this one has to name the missing file.
    expect(screen.getByText(/Nothing has been written to docs\/retro\/ledger\.md/)).toBeInTheDocument();
    expect(screen.getByText("Never written")).toBeInTheDocument();
    // Absence is normal, not an error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("RetroLedgerView — load states", () => {
  it("renders an error state with a retry rather than a blank page", () => {
    const refetch = vi.fn();
    mockLedger(undefined, { isError: true, refetch });
    renderPage();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Could not load the retro ledger.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows neither empty state while the request is still in flight", () => {
    mockLedger(undefined, { isLoading: true });
    renderPage();

    expect(screen.queryByText("No ledger yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No retrospectives recorded yet")).not.toBeInTheDocument();
  });
});
