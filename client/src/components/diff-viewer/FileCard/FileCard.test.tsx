import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import messages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";
import { lineDomId } from "../helpers";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeAll(() => {
  // jsdom has no layout, so scrollIntoView is not implemented. Stub it so the
  // jump is observable — the assertion is that we scrolled to the RIGHT element.
  Element.prototype.scrollIntoView = vi.fn();
});

// New-side numbering: 24 ctx, 25 add, 26 add, 27 ctx.
const PATCH = [
  "@@ -24,3 +24,5 @@",
  "   port: 3000,",
  "+  const key = bucketKey(req);",
  "+  const count = await redis.incr(key);",
  "   redisUrl: x,",
].join("\n");

/** Big enough that the size-based auto-expand does NOT open it (>200 lines). */
const file: PrFile = {
  path: "src/middleware/ratelimit.ts",
  additions: 284,
  deletions: 0,
  patch: PATCH,
};

function renderCard(props: Partial<ComponentProps<typeof FileCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <FileCard file={file} {...props} />
    </NextIntlClientProvider>,
  );
}

/** The card body element — the sibling right after the header holding the path. */
const bodyOf = () => screen.getByText(file.path).parentElement!.nextElementSibling!;
/** The element wrapping one rendered code line (CodeLine's own row wrapper). */
const rowFor = (text: RegExp) => screen.getByText(text).closest("div")!.parentElement!;

describe("FileCard focus", () => {
  it("opens a collapsed file at the focused line and scrolls to it", () => {
    renderCard({ focus: { line: 26 } });

    // Card was collapsed on its own size, and focus forced it open.
    expect(screen.getByText(/redis\.incr/)).toBeInTheDocument();
    // The anchor exists, and it is the one the scroll went to.
    const target = document.getElementById(lineDomId(file.path, 26));
    expect(target).not.toBeNull();
    expect(target).toBe(rowFor(/redis\.incr/).parentElement);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("stays collapsed with no focus, since the file is too big to auto-expand", () => {
    renderCard();
    expect(screen.queryByText(/redis\.incr/)).toBeNull();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("opens the file but scrolls nowhere when the focus carries no line", () => {
    renderCard({ focus: {} });

    expect(screen.getByText(/redis\.incr/)).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    // No line was named, so no line is anchored.
    expect(bodyOf().querySelector('[id^="dv-line:"]')).toBeNull();
  });

  it("opens a file with no patch text without scrolling or throwing", () => {
    // The stub SmartDiffViewer renders for a file the page did not return: it
    // has a header and no diff, so a focus on it has nothing to land on.
    renderCard({ file: { ...file, patch: null }, focus: { line: 26 } });

    expect(screen.getByText(/No diff text available/)).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("anchors only the focused line, leaving the rest of the file untouched", () => {
    renderCard({ focus: { line: 26 } });

    expect(bodyOf().querySelectorAll('[id^="dv-line:"]')).toHaveLength(1);
    // The neighbouring added line is still wrapper-free.
    expect(rowFor(/bucketKey/).parentElement).toBe(bodyOf());
  });

  it("keeps the finding anchor when a flagged line is also the focus target", () => {
    renderCard({ findingLines: [25], focus: { line: 25 } });

    expect(bodyOf().querySelectorAll('[id^="dv-line:"]')).toHaveLength(1);
    expect(document.getElementById(lineDomId(file.path, 25))).not.toBeNull();
  });

  // The regression guard. FileCard renders every diff in the app, so a file with
  // no findings and no focus must stay exactly as it was: its lines sit directly
  // in the card body, with no wrapper element and no anchor id.
  it("renders an unflagged, unfocused line with no wrapper at all", () => {
    renderCard({ defaultOpen: true });

    expect(bodyOf().querySelector('[id^="dv-line:"]')).toBeNull();
    for (const line of [/port: 3000/, /bucketKey/, /redis\.incr/, /redisUrl/]) {
      expect(rowFor(line).parentElement).toBe(bodyOf());
    }
  });

  it("wraps the line only once focused, which is what the guard above detects", () => {
    renderCard({ defaultOpen: true, focus: { line: 26 } });

    expect(rowFor(/redis\.incr/).parentElement).not.toBe(bodyOf());
    expect(rowFor(/bucketKey/).parentElement).toBe(bodyOf());
  });
});
