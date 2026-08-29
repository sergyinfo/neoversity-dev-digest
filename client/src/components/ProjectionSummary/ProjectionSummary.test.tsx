/**
 * ProjectionSummary — the per-agent token-cost projection shared by `/context`
 * and the Agent Editor's Context tab.
 *
 * The behaviours worth guarding: it renders the server's own total rather than
 * summing rows (D-9/§9 — a client sum would understate the real cost), it
 * distinguishes "no agent in view" from "projection unavailable" (D-11/§9),
 * and a disabled linked skill is named as not contributing rather than
 * silently vanishing (REQ-6/AC-30).
 */
import type { ReactElement } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/context.json";
import type { Projection } from "@/lib/hooks/project-context";
import { ProjectionSummary } from "./ProjectionSummary";

afterEach(cleanup);

function renderSummary(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProjectionSummary — AC-17: an agent with direct + inherited attachments", () => {
  // projected_tokens (4,230) deliberately does NOT equal the sum of the entry
  // estimates (1,000 + 1,200 + 900 = 3,100) — the gap is the per-document
  // <untrusted> wrapper plus the "## Project context" heading (D-9). If the
  // component ever starts summing rows itself, this is what would catch it.
  const projection: Projection = {
    agent_id: "agent-1",
    budget_tokens: 8000,
    projected_tokens: 4230,
    entries: [
      { path: "docs/a.md", origin: "agent", tokens_estimate: 1000, outcome: "injected" },
      { path: "docs/b.md", origin: "agent", tokens_estimate: 1200, outcome: "injected" },
      {
        path: "server/docs/c.md",
        origin: "skill",
        via_skill_id: "skill-1",
        tokens_estimate: 900,
        outcome: "injected",
      },
    ],
  };

  it("renders the server's projected total as a fraction of the budget, never a client-side sum", () => {
    renderSummary(<ProjectionSummary hasAgent projection={projection} />);
    expect(screen.getByText("4,230 / 8,000 tokens")).toBeInTheDocument();
    // The naive sum of the three estimates must never appear as the total.
    expect(screen.queryByText(/3,100/)).not.toBeInTheDocument();
  });

  it("lists all three documents with their origin and outcome as words", () => {
    renderSummary(<ProjectionSummary hasAgent projection={projection} />);
    expect(screen.getByText("docs/a.md")).toBeInTheDocument();
    expect(screen.getByText("docs/b.md")).toBeInTheDocument();
    expect(screen.getByText("server/docs/c.md")).toBeInTheDocument();
    expect(screen.getAllByText("Direct")).toHaveLength(2);
    expect(screen.getByText("Inherited via skill")).toBeInTheDocument();
    expect(screen.getAllByText("Injected")).toHaveLength(3);
  });
});

describe("ProjectionSummary — AC-28: no agent in view", () => {
  it("shows no total and no budget fraction, and states an agent is required", () => {
    renderSummary(<ProjectionSummary hasAgent={false} projection={undefined} />);
    expect(screen.getByText("Choose an agent to see a projected token cost for a run.")).toBeInTheDocument();
    expect(screen.queryByText(/\/ 8,000 tokens/)).not.toBeInTheDocument();
    expect(screen.queryByText("Injected")).not.toBeInTheDocument();
  });

  it("ignores a stale projection payload while no agent is in view", () => {
    const stale: Projection = {
      agent_id: "agent-1",
      budget_tokens: 8000,
      projected_tokens: 1000,
      entries: [{ path: "docs/a.md", origin: "agent", tokens_estimate: 1000, outcome: "injected" }],
    };
    renderSummary(<ProjectionSummary hasAgent={false} projection={stale} />);
    expect(screen.getByText(/Choose an agent/)).toBeInTheDocument();
    expect(screen.queryByText("docs/a.md")).not.toBeInTheDocument();
  });
});

describe("ProjectionSummary — AC-30: every linked skill disabled", () => {
  const directOnly: Projection = {
    agent_id: "agent-2",
    budget_tokens: 8000,
    projected_tokens: 500,
    // No skill-origin entries: S6's `resolveForAgent` filters disabled skills
    // out of the projection in SQL, so a disabled skill's documents never
    // reach `entries` at all.
    entries: [{ path: "docs/direct-only.md", origin: "agent", tokens_estimate: 500, outcome: "injected" }],
  };

  it("counts only the direct attachments", () => {
    renderSummary(<ProjectionSummary hasAgent projection={directOnly} />);
    expect(screen.getByText("500 / 8,000 tokens")).toBeInTheDocument();
    expect(screen.getByText("docs/direct-only.md")).toBeInTheDocument();
    expect(screen.queryByText("Inherited via skill")).not.toBeInTheDocument();
  });

  it("names the disabled linked skill as not contributing, rather than omitting it silently", () => {
    renderSummary(
      <ProjectionSummary
        hasAgent
        projection={directOnly}
        disabledSkills={[{ id: "skill-disabled", name: "Security Skill" }]}
      />,
    );
    expect(screen.getByText("Security Skill (disabled — not contributing)")).toBeInTheDocument();
  });

  it("renders nothing for the disabled-skills note when none are disabled", () => {
    renderSummary(<ProjectionSummary hasAgent projection={directOnly} disabledSkills={[]} />);
    expect(screen.queryByText(/not contributing/)).not.toBeInTheDocument();
  });
});

describe("ProjectionSummary — degraded projection (§9)", () => {
  it("says the projection is unavailable rather than falling back to summing rows", () => {
    renderSummary(<ProjectionSummary hasAgent projection={null} />);
    expect(
      screen.getByText("The projection isn’t available right now — showing per-document estimates only."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/ 8,000 tokens/)).not.toBeInTheDocument();
  });

  it("shows a loading state instead of the unavailable copy while the projection is in flight", () => {
    const { container } = renderSummary(
      <ProjectionSummary hasAgent projection={undefined} isLoading />,
    );
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText(/isn’t available/)).not.toBeInTheDocument();
  });
});
