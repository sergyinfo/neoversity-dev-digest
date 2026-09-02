import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../messages/en/context.json";
import evalMessages from "../../../../../../messages/en/eval.json";
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
// S9 — the Evals tab's data hooks. Mocked fully, same style as the block
// above: no `orig` spread, no `QueryClientProvider` required.
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false }),
  useAgentEvalDashboard: () => ({ data: undefined, isLoading: false }),
  useRunEvalSet: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: undefined }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false, variables: undefined, isError: false, error: undefined }),
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
    <NextIntlClientProvider locale="en" messages={{ agents: messages, context: contextMessages, eval: evalMessages }}>
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

describe("S9 — the Evals tab (L06)", () => {
  // The exact regression `client/INSIGHTS.md` (2026-08-29) names next: `TABS`
  // and `page.tsx`'s `VALID_TABS` must BOTH list "evals", or the tab silently
  // falls back to Config instead of 404ing or warning.
  it("renders the Evals panel (not Config) once `tab` is \"evals\"", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByText("Eval metrics")).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });

  it("is switchable — clicking the Evals tab button requests the switch", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getByText("Evals"));
    expect(onTab).toHaveBeenCalledWith("evals");
  });
});
