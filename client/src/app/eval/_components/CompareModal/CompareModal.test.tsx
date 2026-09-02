import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { EvalAgentSnapshot, EvalBatchSummary } from "@/lib/hooks/evals";

/**
 * CompareModal (L06, S11) — old → new metric deltas + a prompt diff.
 * `fireEvent`/no `userEvent` rule doesn't apply here (no interaction to fire),
 * but the file still avoids it per client/INSIGHTS.md.
 */

import { CompareModal } from "./CompareModal";

afterEach(cleanup);

function skill(over: Partial<EvalAgentSnapshot["skills"][number]> = {}): EvalAgentSnapshot["skills"][number] {
  return { id: "sk1", name: "secret-leakage-gate", version: 1, content_hash: "hash-a", ...over };
}

function agent(over: Partial<EvalAgentSnapshot> = {}): EvalAgentSnapshot {
  return {
    id: "ag1",
    name: "Security Reviewer",
    system_prompt: "You are a careful security reviewer. Flag any secrets.",
    model: "gpt-4.1",
    skills: [skill()],
    ...over,
  };
}

function batch(over: Partial<EvalBatchSummary> = {}): EvalBatchSummary {
  return {
    batch_id: "b1",
    ran_at: "2026-08-29T10:00:00.000Z",
    recall: 0.7,
    precision: 0.8,
    citation_accuracy: 0.9,
    traces_passed: 7,
    traces_total: 10,
    cost_usd: 0.12,
    agent: agent(),
    ...over,
  };
}

describe("CompareModal — metric deltas", () => {
  it("renders old and new values for every metric", () => {
    const oldBatch = batch({ batch_id: "old", recall: 0.55, precision: 0.72, citation_accuracy: 0.81 });
    const newBatch = batch({ batch_id: "new", recall: 0.83, precision: 0.61, citation_accuracy: 0.94 });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });
});

describe("CompareModal — prompt diff", () => {
  it("renders a changed word from the diff when the prompts differ", () => {
    const oldBatch = batch({ agent: agent({ system_prompt: "You are a careful security reviewer." }) });
    const newBatch = batch({ agent: agent({ system_prompt: "You are a thorough security reviewer." }) });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    expect(screen.getByText("careful")).toBeInTheDocument();
    expect(screen.getByText("thorough")).toBeInTheDocument();
  });
});

describe("CompareModal — REC-6, identical prompt but a skill's content changed", () => {
  it("names the skill-content change instead of showing an empty/identical diff", () => {
    const oldBatch = batch({ agent: agent({ skills: [skill({ content_hash: "hash-a" })] }) });
    const newBatch = batch({ agent: agent({ skills: [skill({ content_hash: "hash-b" })] }) });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    expect(screen.getByText(/a linked skill.s content changed/i)).toBeInTheDocument();
  });

  it("says nothing changed under the skill's content when both hashes match", () => {
    const oldBatch = batch({ agent: agent({ skills: [skill({ content_hash: "hash-a" })] }) });
    const newBatch = batch({ agent: agent({ skills: [skill({ content_hash: "hash-a" })] }) });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    expect(screen.queryByText(/a linked skill.s content changed/i)).not.toBeInTheDocument();
  });
});

describe("CompareModal — nullable agent snapshot (fix brief)", () => {
  it("renders 'snapshot unavailable' rather than an empty diff when one batch has no snapshot", () => {
    const oldBatch = batch({ agent: null });
    const newBatch = batch({ agent: agent() });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    expect(screen.getByText(/snapshot unavailable/i)).toBeInTheDocument();
    // Never say "identical" when there's nothing to compare.
    expect(screen.queryByText(/a linked skill.s content changed/i)).not.toBeInTheDocument();
  });

  it("renders 'snapshot unavailable' when BOTH batches have no snapshot", () => {
    const oldBatch = batch({ agent: null });
    const newBatch = batch({ agent: null });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    expect(screen.getByText(/snapshot unavailable/i)).toBeInTheDocument();
  });
});
