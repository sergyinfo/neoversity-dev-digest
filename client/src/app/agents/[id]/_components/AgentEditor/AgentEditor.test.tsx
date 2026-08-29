import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// S16 — the Context tab's data hooks. Mocked fully (no `orig` spread, this
// file's existing style) rather than requiring a `QueryClientProvider`.
vi.mock("@/lib/hooks/project-context", () => ({
  useAgentContextProjection: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/lib/hooks/conventions", () => ({
  useSkills: () => ({ data: [] }),
  useAgentSkills: () => ({ data: [] }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, context: contextMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

describe("S16 — the Context tab (BQ-2/b)", () => {
  it("renders, reusing ProjectionSummary against the agent's projection", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
    expect(screen.getByText("Context")).toBeInTheDocument();
    // No projection loaded (mocked `data: undefined`, `isLoading: false`) ⇒
    // ProjectionSummary's degraded state, not a crash.
    expect(
      screen.getByText("The projection isn’t available right now — showing per-document estimates only."),
    ).toBeInTheDocument();
  });

  it("is switchable — clicking the Context tab button requests the switch", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getByText("Context"));
    expect(onTab).toHaveBeenCalledWith("context");
  });

  it("swaps the panel away from Config once `tab` is \"context\"", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });

  it("is read-only — no attach control (`Toggle`, role=\"switch\", is this codebase's attach primitive)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});
