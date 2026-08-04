/**
 * Shared findings vocabulary. These moved out of the PR-detail panel once the PR
 * list and the run timeline needed the same tally, so the guarantees they make —
 * every severity key present, findings attributed to exactly one run — are now
 * relied on by three surfaces rather than one.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_LEVELS, countBySeverity, groupFindingsByRun } from "./findings";

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    severity: "WARNING",
    category: "bug",
    title: "Something",
    rationale: "Because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    ...o,
  } as FindingRecord;
}

describe("countBySeverity", () => {
  it("keeps every level in the result, zeros included", () => {
    const counts = countBySeverity([finding({ id: "1", severity: "CRITICAL" })]);
    expect(Object.keys(counts).sort()).toEqual([...SEVERITY_LEVELS].sort());
    expect(counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it("tallies each level independently", () => {
    const counts = countBySeverity([
      finding({ id: "1", severity: "CRITICAL" }),
      finding({ id: "2", severity: "CRITICAL" }),
      finding({ id: "3", severity: "WARNING" }),
      finding({ id: "4", severity: "SUGGESTION" }),
    ]);
    expect(counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it("ignores a severity outside the enum instead of inventing a key", () => {
    const counts = countBySeverity([
      finding({ id: "1", severity: "INFO" as FindingRecord["severity"] }),
      finding({ id: "2", severity: "WARNING" }),
    ]);
    expect(counts).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
  });

  it("an empty set is all zeros, not an empty object", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe("groupFindingsByRun", () => {
  const a = finding({ id: "a", severity: "CRITICAL" });
  const b = finding({ id: "b", severity: "WARNING" });
  const c = finding({ id: "c", severity: "SUGGESTION" });

  it("buckets findings under the run that produced them", () => {
    const byRun = groupFindingsByRun([
      { run_id: "run-1", findings: [a, b] },
      { run_id: "run-2", findings: [c] },
    ]);
    expect(byRun.get("run-1")).toEqual([a, b]);
    expect(byRun.get("run-2")).toEqual([c]);
  });

  it("merges two reviews that share a run", () => {
    const byRun = groupFindingsByRun([
      { run_id: "run-1", findings: [a] },
      { run_id: "run-1", findings: [b] },
    ]);
    expect(byRun.get("run-1")).toEqual([a, b]);
  });

  it("drops reviews with no run rather than bucketing them under a placeholder", () => {
    const byRun = groupFindingsByRun([
      { run_id: null, findings: [a] },
      { run_id: "run-1", findings: [b] },
    ]);
    expect(byRun.size).toBe(1);
    expect(byRun.get("run-1")).toEqual([b]);
  });

  it("does not alias the caller's arrays — pushing into a bucket cannot mutate a review", () => {
    const review = { run_id: "run-1", findings: [a] };
    const byRun = groupFindingsByRun([review, { run_id: "run-1", findings: [b] }]);
    expect(byRun.get("run-1")).toHaveLength(2);
    expect(review.findings).toEqual([a]);
  });

  it("a run with no findings is simply absent, so callers can tell it apart from zero", () => {
    const byRun = groupFindingsByRun([{ run_id: "run-1", findings: [] }]);
    expect(byRun.get("run-1")).toEqual([]);
    expect(byRun.has("run-2")).toBe(false);
  });
});
