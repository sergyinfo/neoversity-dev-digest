/* CompareModal (L06, S11) — old → new metric deltas plus a word-level diff of
   the two batches' stored `agent.system_prompt` snapshots, read straight from
   the `actual_output` envelope (REC-1/REC-6). Mirrors the design's
   `RunCompare`/`diffTokens` (screen_skills.jsx), adapted to this codebase's
   `Modal` primitive and the batch shape the server actually returns.

   Two obligations carried in from the fix brief:
   - `agent` is nullable on `EvalBatchSummary` by deliberate server design
     (an unindexed/hand-seeded batch). A null snapshot on EITHER side renders
     "snapshot unavailable" — never an empty diff, which would read as "the
     two prompts are identical" when they may not be.
   - REC-6: identical `system_prompt` strings with a DIFFERENT skill
     `content_hash` is exactly the case a raw text diff cannot show, so it is
     called out explicitly instead of silently rendering "no changes". */
"use client";

import React from "react";
import { Icon, Modal } from "@devdigest/ui";
import { formatCost } from "@/lib/cost";
import type { EvalBatchSummary } from "@/lib/hooks/evals";
import { s } from "./styles";

/** Word-level diff (LCS), same shape as the design reference: a same/del/add
 * token stream. */
type DiffToken = { text: string; kind: "same" | "del" | "add" };

/**
 * The most DP cells the LCS below may allocate — a `number[][]`, so roughly 8
 * bytes a cell: 4M cells is ~32 MB and finishes in well under a second.
 *
 * This bound is not a nicety. A system prompt is free text and user-edited, so
 * both inputs are unbounded, and the matrix used to be allocated unconditionally
 * over whitespace-split tokens: two 8,000-word prompts are ~16,000 tokens each,
 * i.e. a 256M-cell matrix — about 2 GB of JS numbers — which freezes or kills
 * the tab the moment Compare is pressed, on the feature's headline screen.
 */
const MAX_DIFF_CELLS = 4_000_000;

/** The LCS walk itself, over whatever units it is handed — words, or lines. */
function lcsDiff(aw: readonly string[], bw: readonly string[]): DiffToken[] {
  const n = aw.length;
  const m = bw.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = aw[i] === bw[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aw[i] === bw[j]) {
      out.push({ text: aw[i]!, kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ text: aw[i]!, kind: "del" });
      i++;
    } else {
      out.push({ text: bw[j]!, kind: "add" });
      j++;
    }
  }
  while (i < n) out.push({ text: aw[i++]!, kind: "del" });
  while (j < m) out.push({ text: bw[j++]!, kind: "add" });
  return out;
}

/**
 * A word-level diff that DEGRADES instead of dying: words → lines → "replaced
 * wholesale", picking the finest granularity that stays under `MAX_DIFF_CELLS`.
 *
 * Every step returns the same token-stream shape, so the renderer needs no
 * branch of its own — only the size of the highlighted unit changes. That is
 * the honest thing to give up on a 16,000-word prompt: nobody reads one of
 * those word by word, and a coarse diff that renders beats a precise one that
 * hangs the tab. Hirschberg's linear-space LCS would preserve word granularity
 * at these sizes, but it is a lot of algorithm for a screen that is already
 * unreadable at that length.
 */
function diffWords(a: string, b: string): DiffToken[] {
  const aWords = a.split(/(\s+)/);
  const bWords = b.split(/(\s+)/);
  if (aWords.length * bWords.length <= MAX_DIFF_CELLS) return lcsDiff(aWords, bWords);

  // Lines are far fewer units for the same text. Splitting on a CAPTURED `\n`
  // keeps the newlines as tokens of their own, so the rendered text is still
  // the input verbatim rather than a reflowed copy of it.
  const aLines = a.split(/(\n)/);
  const bLines = b.split(/(\n)/);
  if (aLines.length * bLines.length <= MAX_DIFF_CELLS) return lcsDiff(aLines, bLines);

  // Two prompts so large that even a line diff is quadratic — a single 4 MB
  // line, say. There is no useful alignment to show at that size; "all of this
  // went, all of that arrived" is at least true, and it is bounded.
  return [
    { text: a, kind: "del" },
    { text: b, kind: "add" },
  ];
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function Metric({
  label,
  oldV,
  newV,
  color,
  format,
}: {
  label: string;
  oldV: number;
  newV: number;
  color: string;
  format: (v: number) => string;
}) {
  const d = newV - oldV;
  const up = d > 0;
  const flat = Math.abs(d) < 1e-9;
  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div style={s.metricValues}>
        <span style={s.oldValue}>{format(oldV)}</span>
        <Icon.ArrowRight size={13} style={{ color: "var(--text-muted)" }} />
        <span style={{ ...s.newValue, color }}>{format(newV)}</span>
        {!flat && (
          <span style={{ ...s.delta, color: up ? "var(--ok)" : "var(--crit)" }}>
            {up ? "▲" : "▼"} {format(Math.abs(d))}
          </span>
        )}
      </div>
    </div>
  );
}

export function CompareModal({
  oldBatch,
  newBatch,
  onClose,
}: {
  oldBatch: EvalBatchSummary;
  newBatch: EvalBatchSummary;
  onClose: () => void;
}) {
  const oldAgent = oldBatch.agent;
  const newAgent = newBatch.agent;
  const snapshotsAvailable = !!oldAgent && !!newAgent;

  const promptsIdentical = snapshotsAvailable && oldAgent!.system_prompt === newAgent!.system_prompt;
  const skillHashChanged =
    snapshotsAvailable &&
    promptsIdentical &&
    (() => {
      const oldSkills = oldAgent!.skills;
      const newSkills = newAgent!.skills;
      if (oldSkills.length !== newSkills.length) return true;
      const byId = new Map(oldSkills.map((sk) => [sk.id, sk]));
      return newSkills.some((sk) => byId.get(sk.id)?.content_hash !== sk.content_hash);
    })();

  const tokens = snapshotsAvailable && !promptsIdentical ? diffWords(oldAgent!.system_prompt, newAgent!.system_prompt) : [];

  return (
    <Modal
      width={960}
      onClose={onClose}
      title={`Compare runs · ${new Date(oldBatch.ran_at).toLocaleString()} → ${new Date(newBatch.ran_at).toLocaleString()}`}
      subtitle="Old batch vs new — metric deltas and a prompt diff"
    >
      <div style={s.body}>
        <div style={s.metricsRow}>
          <Metric label="Recall" oldV={oldBatch.recall} newV={newBatch.recall} color="var(--accent)" format={fmtPct} />
          <Metric label="Precision" oldV={oldBatch.precision} newV={newBatch.precision} color="var(--ok)" format={fmtPct} />
          <Metric
            label="Citation accuracy"
            oldV={oldBatch.citation_accuracy}
            newV={newBatch.citation_accuracy}
            color="var(--warn)"
            format={fmtPct}
          />
          <Metric
            label="Cost"
            oldV={oldBatch.cost_usd ?? 0}
            newV={newBatch.cost_usd ?? 0}
            color="var(--text-primary)"
            format={(v) => formatCost(v)}
          />
        </div>

        <div style={s.sectionTitle}>System prompt diff</div>

        {!snapshotsAvailable ? (
          <div style={s.unavailable}>Snapshot unavailable for one of these runs — no prompt to compare.</div>
        ) : promptsIdentical ? (
          <>
            <div style={s.diffBox}>{oldAgent!.system_prompt || "(empty system prompt)"}</div>
            {skillHashChanged && (
              <div style={s.note}>
                <Icon.AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
                <span>
                  The system prompt is unchanged, but a linked skill&rsquo;s content changed between these two
                  runs — the metric move above may be explained by that, not by the prompt.
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={s.legend}>
              <span style={s.legendItem}>
                <span style={{ ...s.legendSwatch, background: "var(--code-del)" }} />
                Old
              </span>
              <span style={s.legendItem}>
                <span style={{ ...s.legendSwatch, background: "var(--code-add)" }} />
                New
              </span>
            </div>
            <div style={s.diffBox}>
              {tokens.map((tk, i) => (
                <span
                  key={i}
                  style={{
                    background: tk.kind === "add" ? "var(--code-add)" : tk.kind === "del" ? "var(--code-del)" : "transparent",
                    color: tk.kind === "same" ? "var(--text-secondary)" : "var(--text-primary)",
                    textDecoration: tk.kind === "del" ? "line-through" : "none",
                  }}
                >
                  {tk.text}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
