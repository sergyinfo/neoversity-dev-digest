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
    precision_undefined: false,
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

describe("CompareModal — long prompts do not allocate a quadratic matrix (fix brief F5)", () => {
  /**
   * 8,000 words with a newline every 10, so the text has ~800 lines. Split on
   * whitespace that is ~16,000 tokens, and the word-level DP over two of these
   * is 16,000 x 16,000 = 256M cells — roughly 2 GB of JS numbers. Before the
   * length guard this render allocated exactly that and froze (or killed) the
   * tab; the test below would not have completed at all.
   */
  function longPrompt(marker: string): string {
    const words = Array.from({ length: 8_000 }, (_, i) => (i === 4_000 ? marker : `word${i}`));
    return words.map((w, i) => (i > 0 && i % 10 === 0 ? `\n${w}` : w)).join(" ");
  }

  it("renders a usable diff for two ~8,000-word prompts", { timeout: 10_000 }, () => {
    const oldBatch = batch({ agent: agent({ system_prompt: longPrompt("BEFOREWORD") }) });
    const newBatch = batch({ agent: agent({ system_prompt: longPrompt("AFTERWORD") }) });

    const { container } = render(
      <CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />,
    );

    // It is a real diff, not the "snapshot unavailable" or "identical" branch:
    // the one line that actually changed is present on both sides.
    expect(screen.getByText(/BEFOREWORD/)).toBeInTheDocument();
    expect(screen.getByText(/AFTERWORD/)).toBeInTheDocument();
    expect(screen.queryByText(/snapshot unavailable/i)).not.toBeInTheDocument();

    // ...and it fell back to LINE granularity rather than emitting a span per
    // word. ~800 lines a side, so a few thousand spans at most — where word
    // granularity would be ~32,000 (if it had survived the allocation).
    expect(container.querySelectorAll("span").length).toBeLessThan(5_000);
  });

  it("still diffs by WORD at ordinary prompt lengths", () => {
    const oldBatch = batch({ agent: agent({ system_prompt: "You are a careful security reviewer." }) });
    const newBatch = batch({ agent: agent({ system_prompt: "You are a thorough security reviewer." }) });
    render(<CompareModal oldBatch={oldBatch} newBatch={newBatch} onClose={vi.fn()} />);

    // A whole-line fallback would render the entire sentence as one del + one
    // add; word granularity isolates the single word that moved.
    expect(screen.getByText("careful")).toBeInTheDocument();
    expect(screen.getByText("thorough")).toBeInTheDocument();
  });
});
