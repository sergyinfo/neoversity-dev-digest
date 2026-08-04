import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { confidenceFiltered, countBySeverity, visibleFindings } from "./helpers";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";

function finding(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: over.id,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

// Two CRITICAL (one of them low-confidence), one WARNING, no SUGGESTION.
const FINDINGS: FindingRecord[] = [
  finding({ id: "w1", severity: "WARNING" }),
  finding({ id: "c1", severity: "CRITICAL" }),
  finding({ id: "c-low", severity: "CRITICAL", confidence: LOW_CONFIDENCE_THRESHOLD - 0.1 }),
];

describe("confidenceFiltered", () => {
  it("keeps everything when hideLow is off", () => {
    expect(confidenceFiltered(FINDINGS, false)).toHaveLength(3);
  });

  it("drops findings below the threshold when hideLow is on", () => {
    expect(confidenceFiltered(FINDINGS, true).map((f) => f.id)).toEqual(["w1", "c1"]);
  });

  it("keeps a finding sitting exactly on the threshold", () => {
    const edge = [finding({ id: "edge", confidence: LOW_CONFIDENCE_THRESHOLD })];
    expect(confidenceFiltered(edge, true)).toHaveLength(1);
  });
});

describe("countBySeverity", () => {
  it("reports every level, including levels with no findings", () => {
    expect(countBySeverity(FINDINGS)).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
  });

  it("counts the confidence-filtered set so totals match the rendered list", () => {
    const eligible = confidenceFiltered(FINDINGS, true);
    const counts = countBySeverity(eligible);
    expect(counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(visibleFindings(FINDINGS, true).length);
  });

  it("returns all zeros for an empty list", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe("visibleFindings", () => {
  it("sorts by severity weight, criticals first", () => {
    expect(visibleFindings(FINDINGS, false).map((f) => f.severity)).toEqual([
      "CRITICAL",
      "CRITICAL",
      "WARNING",
    ]);
  });

  it("narrows to a single severity when one is selected", () => {
    expect(visibleFindings(FINDINGS, false, "CRITICAL").map((f) => f.id)).toEqual(["c1", "c-low"]);
  });

  it("combines the severity filter with hideLow", () => {
    expect(visibleFindings(FINDINGS, true, "CRITICAL").map((f) => f.id)).toEqual(["c1"]);
  });

  it("returns nothing for a severity with no findings", () => {
    expect(visibleFindings(FINDINGS, false, "SUGGESTION")).toEqual([]);
  });

  it("defaults to no severity filter when the argument is omitted", () => {
    expect(visibleFindings(FINDINGS, false)).toHaveLength(3);
  });
});
