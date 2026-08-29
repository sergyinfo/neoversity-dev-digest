import { describe, it, expect } from "vitest";
import { entriesAfterMarker, forDisplay, formatUpdatedAt, hasEntries } from "./constants";

/**
 * The "has this ledger got entries?" rule. It decides whether the page shows an
 * empty state over real content, so its edge cases are worth naming.
 */
describe("hasEntries", () => {
  const preamble = "# Retro ledger\n\nWhat this is.\n\n---\n\n<!-- entries below, newest first -->";

  it("is false for a preamble that ends at the marker — today's file", () => {
    expect(hasEntries(preamble)).toBe(false);
  });

  it("is false when only whitespace follows the marker", () => {
    expect(hasEntries(`${preamble}\n\n   \n`)).toBe(false);
  });

  it("is true once an entry is appended below the marker", () => {
    expect(hasEntries(`${preamble}\n\n## 2026-08-29\n\nWhat happened.`)).toBe(true);
  });

  it("is false for an empty file", () => {
    expect(hasEntries("")).toBe(false);
    expect(hasEntries("   \n\n")).toBe(false);
  });

  /**
   * Fails towards SHOWING content: with no marker we cannot tell preamble from
   * entries, and covering a real ledger with a "nothing here yet" panel is the
   * worse of the two mistakes.
   */
  it("treats a marker-less file with content as having entries", () => {
    expect(hasEntries("# Retro ledger\n\n## 2026-08-29\n\nWhat happened.")).toBe(true);
    expect(entriesAfterMarker("# Retro ledger")).toBeNull();
  });
});

describe("formatUpdatedAt", () => {
  it("returns null for a missing or unparseable timestamp", () => {
    expect(formatUpdatedAt(null)).toBeNull();
    expect(formatUpdatedAt("not-a-date")).toBeNull();
  });

  it("renders a date and a time, since it is a file mtime", () => {
    const out = formatUpdatedAt("2026-08-29T12:03:00.000Z");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

/**
 * The vendored `Markdown` primitive has no `rehype-raw`, so raw HTML is
 * ESCAPED and shown as literal text — an HTML comment left in the source
 * appears on the page verbatim. This is what keeps that off the screen.
 */
describe("forDisplay", () => {
  it("removes the entries marker, which would otherwise render as visible text", () => {
    const out = forDisplay("# Retro ledger\n\n<!-- entries below, newest first -->\n");
    expect(out).not.toContain("entries below, newest first");
    expect(out).not.toContain("<!--");
  });

  it("removes a multi-line comment too", () => {
    expect(forDisplay("a\n<!--\nnote\n-->\nb")).not.toContain("note");
  });

  it("leaves every other byte of the document alone", () => {
    const body = "# Retro ledger\n\nProse with `code`, **bold** and a <not-a-comment> tag.";
    expect(forDisplay(body)).toBe(body);
  });
});
