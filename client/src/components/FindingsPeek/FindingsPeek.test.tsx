/**
 * FindingsPeek — the severity badges + findings preview shared by the PR list
 * and the run timeline.
 *
 * The behaviours worth guarding: the badges must not claim findings the popup
 * cannot show, the popup must be reachable without a mouse, and opening it must
 * never navigate the row underneath.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsPeek } from "./FindingsPeek";
import { MAX_PREVIEW_ITEMS } from "./constants";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    file: "src/api/webhooks.ts",
    start_line: 73,
    end_line: 73,
    severity: "CRITICAL",
    category: "security",
    title: "SSRF via user-supplied URL",
    explanation: "An untrusted `callback_url` drives an outbound request.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    ...o,
  } as FindingRecord;
}

const counts = { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 };

describe("FindingsPeek — badges", () => {
  it("renders a number per non-zero severity and omits the empty ones", () => {
    render(<FindingsPeek counts={counts} items={[]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("a never-reviewed PR is an em dash, not a row of zeros", () => {
    render(<FindingsPeek counts={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reviewed-and-clean is also a dash — an openable badge with nothing behind it is a lie", () => {
    render(<FindingsPeek counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} items={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names the totals for screen readers rather than leaving bare numerals", () => {
    render(<FindingsPeek counts={counts} items={[]} label="#482" />);
    expect(
      screen.getByRole("button", { name: /3 findings on #482: 1 critical, 2 warning/i }),
    ).toBeInTheDocument();
  });

  it("shows the blockers suffix only when there are blockers", () => {
    const { rerender } = render(<FindingsPeek counts={counts} items={[]} blockers={2} />);
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
    rerender(<FindingsPeek counts={counts} items={[]} blockers={0} />);
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });
});

describe("FindingsPeek — the preview", () => {
  const items = [finding({ id: "f1" })];

  it("opens on hover and closes when the pointer leaves", () => {
    render(<FindingsPeek counts={counts} items={items} />);
    const host = screen.getByRole("button");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(host);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("SSRF via user-supplied URL")).toBeInTheDocument();

    fireEvent.mouseLeave(host);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus, so the preview is not mouse-only", () => {
    render(<FindingsPeek counts={counts} items={items} />);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("click pins it open, and Escape closes it again", () => {
    render(<FindingsPeek counts={counts} items={items} />);
    const host = screen.getByRole("button");

    fireEvent.click(host);
    fireEvent.mouseLeave(host); // pointer gone, but it stays: it was pinned
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(host, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not let the click reach the row underneath", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <FindingsPeek counts={counts} items={items} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders file:line as a single number, and as a range when the finding spans lines", () => {
    const { rerender } = render(<FindingsPeek counts={counts} items={items} />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByText("src/api/webhooks.ts:73")).toBeInTheDocument();

    rerender(
      <FindingsPeek counts={counts} items={[finding({ id: "f1", start_line: 10, end_line: 18 })]} />,
    );
    expect(screen.getByText("src/api/webhooks.ts:10-18")).toBeInTheDocument();
  });

  it("strips markdown emphasis instead of printing the asterisks", () => {
    render(
      <FindingsPeek
        counts={counts}
        items={[finding({ id: "f1", explanation: "A **live** key in `config.ts`." })]}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByText("A live key in config.ts.")).toBeInTheDocument();
  });
});

describe("FindingsPeek — lazy loading and truncation", () => {
  it("asks for the findings the first time it opens, and only once", () => {
    const onOpen = vi.fn();
    render(<FindingsPeek counts={counts} items={[finding({ id: "f1" })]} onOpen={onOpen} />);
    const host = screen.getByRole("button");

    fireEvent.mouseEnter(host);
    fireEvent.mouseLeave(host);
    fireEvent.mouseEnter(host);

    expect(onOpen).toHaveBeenCalledTimes(2); // once per open, not per render
  });

  it("says it is loading rather than showing an empty card", () => {
    render(<FindingsPeek counts={counts} items={undefined} onOpen={() => {}} />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByText(/loading findings/i)).toBeInTheDocument();
  });

  it("caps the list and says how many it left out", () => {
    const many = Array.from({ length: MAX_PREVIEW_ITEMS + 3 }, (_, i) =>
      finding({ id: `f${i}`, title: `Finding ${i}` }),
    );
    render(<FindingsPeek counts={{ CRITICAL: many.length, WARNING: 0, SUGGESTION: 0 }} items={many} />);
    fireEvent.mouseEnter(screen.getByRole("button"));

    expect(screen.getByText(`Finding ${MAX_PREVIEW_ITEMS - 1}`)).toBeInTheDocument();
    expect(screen.queryByText(`Finding ${MAX_PREVIEW_ITEMS}`)).not.toBeInTheDocument();
    expect(screen.getByText(/\+3 more/)).toBeInTheDocument();
  });

  it("counts the whole set in the header, not just the shown slice", () => {
    const many = Array.from({ length: MAX_PREVIEW_ITEMS + 3 }, (_, i) => finding({ id: `f${i}` }));
    render(<FindingsPeek counts={{ CRITICAL: many.length, WARNING: 0, SUGGESTION: 0 }} items={many} />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByText(`${many.length} findings`)).toBeInTheDocument();
  });
});
