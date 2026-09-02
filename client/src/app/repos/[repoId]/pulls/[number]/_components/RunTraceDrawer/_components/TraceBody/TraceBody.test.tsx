import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json"; // client/messages/en/runs.json

import { TraceBody } from "./TraceBody";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * Base trace shared by both ACs — only `prompt_assembly.specs` and
 * `specs_read` vary between them (S17: unmodified `TraceBody.tsx`).
 */
const BASE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 0, grounding: "0/0 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: null, memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: "",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

const FINDINGS: FindingRecord[] = [];

describe("TraceBody — project context (S17, AC-24/AC-25)", () => {
  it("AC-24: expands the Project context block to the full injected text, and lists every attachment with its outcome", () => {
    const injectedText =
      '## Project context <untrusted source="spec-0"> This repo uses pnpm workspaces are NOT used — each package is standalone. </untrusted>';
    const trace: RunTrace = {
      ...BASE,
      prompt_assembly: { ...BASE.prompt_assembly, specs: injectedText },
      specs_read: [
        "docs/architecture.md",
        "docs/legacy-notes.md — dropped for budget (4000 tokens)",
        "src/big-schema.md — over the 65536 byte per-document cap",
      ],
    };

    renderWithIntl(<TraceBody trace={trace} findings={FINDINGS} />);

    // "Specs read" lists every attachment with its outcome, including the
    // bare-path (injected) form and the "path — reason" (skipped/dropped) form.
    expect(screen.getByText("Specs read")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("docs/legacy-notes.md — dropped for budget (4000 tokens)")).toBeInTheDocument();
    expect(screen.getByText("src/big-schema.md — over the 65536 byte per-document cap")).toBeInTheDocument();
    // The "none" empty state must not leak in when attachments exist.
    expect(screen.queryByText("none")).not.toBeInTheDocument();

    // The Prompt assembly TraceSection is collapsed by default; open it first.
    fireEvent.click(screen.getByText("Prompt assembly"));

    // The "Project context" PromptBlock renders, collapsed by default …
    const header = screen.getByText("Project context (dynamic)");
    expect(header).toBeInTheDocument();
    expect(screen.queryByText(injectedText)).not.toBeInTheDocument();

    // … and expands to the full injected text on click.
    fireEvent.click(header);
    expect(screen.getByText(injectedText)).toBeInTheDocument();
  });

  it("AC-25: with no project context, no block renders, and Specs read shows its none state", () => {
    const trace: RunTrace = {
      ...BASE,
      prompt_assembly: { ...BASE.prompt_assembly, specs: null },
      specs_read: [],
    };

    renderWithIntl(<TraceBody trace={trace} findings={FINDINGS} />);

    expect(screen.getByText("Specs read")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();

    // Open the Prompt assembly section so an absent block is a real assertion,
    // not just "never rendered because the section itself is collapsed".
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.queryByText("Project context (dynamic)")).not.toBeInTheDocument();
  });
});
