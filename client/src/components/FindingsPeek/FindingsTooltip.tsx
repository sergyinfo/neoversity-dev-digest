"use client";

import React from "react";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { MAX_PREVIEW_ITEMS } from "./constants";
import { lineRange, stripMd } from "./helpers";
import { s } from "./styles";

/**
 * The hover card: a compact preview of findings, ported from
 * `FindingsTooltip` in the design bundle.
 *
 * Long lists are capped at MAX_PREVIEW_ITEMS with an explicit "+N more" line —
 * a silently truncated list reads as the complete one.
 */
export function FindingsTooltip({
  items,
  placement = "down",
  width = 380,
  anchor,
}: {
  items: FindingRecord[];
  placement?: "up" | "down";
  width?: number;
  /** Trigger rect; when given the card is positioned against the viewport. */
  anchor?: DOMRect;
}) {
  const shown = items.slice(0, MAX_PREVIEW_ITEMS);
  const hidden = items.length - shown.length;

  return (
    <div role="tooltip" style={s.card(placement, width, anchor)}>
      <div style={s.cardHead}>
        <Icon.AlertOctagon size={12} />
        {items.length} findings
      </div>
      <div style={s.list}>
        {shown.map((f, i) => (
          <div key={f.id} style={s.item(i === shown.length - 1)}>
            <div style={s.itemHead}>
              <SeverityBadge severity={f.severity} compact />
              <span style={s.itemTitle}>{f.title}</span>
              <CategoryTag category={f.category} />
            </div>
            <div style={s.itemMeta}>
              <span className="mono" style={s.itemLoc} title={`${f.file}:${lineRange(f)}`}>
                {f.file}:{lineRange(f)}
              </span>
              <span style={s.confidence}>
                <ConfidenceNum value={f.confidence} />
              </span>
            </div>
            <div style={s.itemBody}>{stripMd(f.rationale)}</div>
          </div>
        ))}
      </div>
      {hidden > 0 && <div style={s.more}>+{hidden} more — open the PR to see them all</div>}
    </div>
  );
}
