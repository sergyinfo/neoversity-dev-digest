import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no layout, so scrollIntoView is not implemented. Stub it so the
  // jump is observable — the assertion is that we scrolled to the RIGHT element.
  Element.prototype.scrollIntoView = vi.fn();
});

const PATCH = [
  "@@ -24,3 +24,5 @@",
  "   port: 3000,",
  "+  const key = bucketKey(req);",
  "+  const count = await redis.incr(key);",
  "   redisUrl: x,",
].join("\n");

const files: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: PATCH },
  { path: "src/config.ts", additions: 4, deletions: 0, patch: PATCH },
  { path: "package-lock.json", additions: 920, deletions: 240, patch: PATCH },
];

const smartDiff: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [25, 26],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/config.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 920,
          deletions: 240,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1248, proposed_splits: [] },
};

function renderViewer(
  sd: SmartDiff = smartDiff,
  onOpenFinding?: (path: string, line: number) => void,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <SmartDiffViewer smartDiff={sd} files={files} onOpenFinding={onOpenFinding} />
    </NextIntlClientProvider>,
  );
}

/** A file's card is the element containing its path; the body renders code lines. */
const cardFor = (path: string) => screen.getByText(path).closest("div")!.parentElement!;

describe("SmartDiffViewer", () => {
  it("renders the groups core → wiring → boilerplate, in that order", () => {
    renderViewer();
    const headings = screen.getAllByText(/Core logic|Wiring|Boilerplate/);
    expect(headings.map((h) => h.textContent)).toEqual(["Core logic", "Wiring", "Boilerplate"]);
  });

  it("shows core logic before the lock file in the document", () => {
    renderViewer();
    const core = screen.getByText("src/middleware/ratelimit.ts");
    const lock = screen.getByText("package-lock.json");
    // Node.compareDocumentPosition: 4 === "lock follows core"
    expect(core.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the lock file collapsed even though findings would expand it", () => {
    renderViewer();
    // The boilerplate card renders its header but no code lines.
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(within(cardFor("package-lock.json")).queryByText(/bucketKey/)).toBeNull();
  });

  it("expands core logic so the substance is visible without a click", () => {
    renderViewer();
    expect(within(cardFor("src/middleware/ratelimit.ts")).getByText(/bucketKey/)).toBeTruthy();
  });

  it("badges a file with its finding count", () => {
    renderViewer();
    expect(screen.getByRole("button", { name: /2 findings/i })).toBeInTheDocument();
  });

  it("shows no badge on a file the review did not flag", () => {
    renderViewer();
    expect(within(cardFor("src/config.ts")).queryByRole("button", { name: /finding/i })).toBeNull();
  });

  it("scrolls to the flagged line when the badge is clicked", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /2 findings/i }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("renders every group header even when a group is empty", () => {
    renderViewer({
      ...smartDiff,
      groups: [{ role: "core", files: smartDiff.groups[0]!.files }],
    });
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("surfaces a split suggestion only when the PR is too big", () => {
    renderViewer();
    expect(screen.queryByText(/This PR is large/)).toBeNull();

    cleanup();
    renderViewer({
      ...smartDiff,
      split_suggestion: {
        too_big: true,
        total_lines: 1248,
        proposed_splits: [{ name: "src/middleware", files: ["src/middleware/ratelimit.ts"] }],
      },
    });
    const note = screen.getByText(/This PR is large/).closest("div")!;
    // Scoped to the note: the same path also appears as a file header above, so
    // a bare getByText would match two nodes and pass for the wrong reason.
    expect(note.textContent).toMatch(/It could split along: src\/middleware/);
    expect(note.textContent).toMatch(/1248 changed/);
  });
  it("offers a Findings link only when a handler is supplied", () => {
    renderViewer();
    expect(screen.queryByRole("button", { name: /Findings tab/i })).toBeNull();

    cleanup();
    renderViewer(smartDiff, vi.fn());
    expect(screen.getByRole("button", { name: /Findings tab/i })).toBeInTheDocument();
  });

  it("hands the flagged file and its first line to the Findings handler", () => {
    const onOpenFinding = vi.fn();
    renderViewer(smartDiff, onOpenFinding);
    fireEvent.click(screen.getByRole("button", { name: /Findings tab/i }));
    expect(onOpenFinding).toHaveBeenCalledWith("src/middleware/ratelimit.ts", 25);
  });

  it("keeps the badge's in-diff jump separate from the Findings link", () => {
    const onOpenFinding = vi.fn();
    renderViewer(smartDiff, onOpenFinding);
    // Clicking the count must still scroll within the diff, NOT navigate away —
    // the two affordances sit side by side precisely so neither replaces the other.
    fireEvent.click(screen.getByRole("button", { name: /2 findings/i }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(onOpenFinding).not.toHaveBeenCalled();
  });
});
