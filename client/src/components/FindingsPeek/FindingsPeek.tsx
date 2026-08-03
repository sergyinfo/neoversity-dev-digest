"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "@/lib/findings";
import { DEFAULT_WIDTH } from "./constants";
import { FindingsTooltip } from "./FindingsTooltip";
import { s } from "./styles";

/**
 * Severity badges with a findings preview — the PR list's findings cell and the
 * run timeline's findings line are the same widget.
 *
 * Opens on hover AND on click/Enter. Hover alone would put the preview out of
 * reach of keyboard and touch users, and this is the only place these findings
 * are summarized outside the PR page.
 *
 * `items` is allowed to arrive later than `counts`: the list gets three integers
 * with the row and fetches the findings themselves only once someone actually
 * looks. `onOpen` is the hook for that fetch.
 */
export function FindingsPeek({
  counts,
  items,
  onOpen,
  placement = "down",
  width = DEFAULT_WIDTH,
  blockers,
  label,
}: {
  /** Per-severity tally. Null means "never reviewed" and renders as an em dash. */
  counts: Record<Severity, number> | null | undefined;
  /** Findings for the preview. `undefined` = not loaded yet (shows a hint). */
  items?: FindingRecord[];
  /** Fired the first time the card opens — use it to kick off a lazy fetch. */
  onOpen?: () => void;
  placement?: "up" | "down";
  width?: number;
  /** Optional "· N blockers" suffix (the timeline shows it, the list doesn't). */
  blockers?: number | null;
  /** What these findings belong to, for the screen-reader label. */
  label?: string;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const open = hovered || pinned;

  // Fire onOpen on the transition into open, not on every render while open.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) onOpen?.();
    wasOpen.current = open;
  }, [open, onOpen]);

  // The card is viewport-positioned (see styles.card), so it needs the trigger's
  // rect — re-measured on scroll and resize, or it drifts away from its row.
  const hostRef = React.useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = React.useState<DOMRect | undefined>(undefined);
  React.useEffect(() => {
    if (!open) return;
    const measure = () => setAnchor(hostRef.current?.getBoundingClientRect());
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const present = counts
    ? SEVERITY_LEVELS.filter((sv) => (counts[sv] ?? 0) > 0)
    : ([] as Severity[]);

  // Never reviewed, or reviewed and clean — both are a dash, and neither opens a
  // card. A tooltip listing nothing is worse than no tooltip.
  if (!counts || present.length === 0) {
    return <span style={s.empty}>—</span>;
  }

  const total = present.reduce((n, sv) => n + counts[sv], 0);
  const summary = present.map((sv) => `${counts[sv]} ${sv.toLowerCase()}`).join(", ");

  return (
    <button
      ref={hostRef}
      type="button"
      aria-expanded={open}
      aria-label={`${total} findings${label ? ` on ${label}` : ""}: ${summary}. Show details`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => {
        setHovered(false);
        setPinned(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setPinned(false);
      }}
      onClick={(e) => {
        // The whole row is usually a link to the PR; opening the preview must not
        // navigate away from the thing being previewed.
        e.stopPropagation();
        setPinned((p) => !p);
      }}
      style={s.host}
    >
      {present.map((sv) => {
        const meta = SEV[sv];
        const SevIcon = Icon[meta.icon];
        return (
          <span key={sv} style={s.count(meta.c)}>
            <SevIcon size={12.5} />
            <span className="tnum">{counts[sv]}</span>
          </span>
        );
      })}
      {(blockers ?? 0) > 0 && <span style={s.blockers}>· {blockers} blockers</span>}
      {open &&
        (items === undefined ? (
          <div role="tooltip" style={s.card(placement, width, anchor)}>
            <div style={s.cardHead}>
              <Icon.RefreshCw size={12} />
              loading findings…
            </div>
          </div>
        ) : (
          items.length > 0 && (
            <FindingsTooltip
              items={items}
              placement={placement}
              width={width}
              anchor={anchor}
            />
          )
        ))}
    </button>
  );
}
