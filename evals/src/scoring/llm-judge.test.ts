import { describe, expect, test } from "vitest";
import { isDegenerate } from "./llm-judge.js";

const r = (passed: boolean, evidence = "") => ({ practice: "p", passed, evidence });

describe("isDegenerate", () => {
  test("fires when every practice fails with nothing quoted", () => {
    // The shape CI produced on the skills tier: five FAILs, five empty quotes.
    expect(isDegenerate([r(false), r(false), r(false), r(false), r(false)])).toBe(true);
  });

  test("does not fire when a failure is actually argued", () => {
    // A judge that read the output and disagreed cites what it read. That is a real zero.
    expect(isDegenerate([r(false, "no severity tier appears in the report"), r(false)])).toBe(false);
  });

  test("does not fire when anything passed", () => {
    expect(isDegenerate([r(true, "P1 — two lockfiles"), r(false)])).toBe(false);
  });

  test("treats whitespace as no evidence", () => {
    expect(isDegenerate([r(false, "   "), r(false, "\n")])).toBe(true);
  });

  test("does not fire on an empty result set", () => {
    // Nothing was judged; that is a parse problem, handled before this point.
    expect(isDegenerate([])).toBe(false);
  });
});
