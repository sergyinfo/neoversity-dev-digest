/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES, FINDING_FLASH_MS } from "../constants";
import { parsePatch, lineDomId, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  findingLines,
  onOpenFindings,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /**
   * Overrides the size-based auto-expand. Smart Diff uses it to keep boilerplate
   * shut regardless of how small the change is, and to open anything carrying a
   * finding regardless of how large.
   */
  defaultOpen?: boolean;
  /** New-side line numbers flagged by the latest review. Drives the badge. */
  findingLines?: number[];
  /**
   * Open this file's first finding in the Findings tab. Optional, and passed in
   * rather than routed here on purpose: `diff-viewer` is shared across routes
   * and must not know that a Findings tab exists. Absent → the control is not
   * rendered, and the badge's in-diff jump is the only affordance.
   */
  onOpenFindings?: () => void;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const [flashed, setFlashed] = React.useState<number | null>(null);
  const [pendingJump, setPendingJump] = React.useState<number | null>(null);
  const flagged = React.useMemo(() => new Set(findingLines ?? []), [findingLines]);

  /**
   * Jump to a flagged line. The scroll runs in an effect rather than in the
   * click handler because the target may not be in the DOM yet — clicking the
   * badge of a COLLAPSED file has to open it first, and the lines only mount on
   * the following render.
   */
  React.useEffect(() => {
    if (pendingJump == null || !open) return;
    const el = document.getElementById(lineDomId(file.path, pendingJump));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashed(pendingJump);
    setPendingJump(null);
    const timer = window.setTimeout(() => setFlashed(null), FINDING_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [pendingJump, open, file.path]);

  const jumpToFirstFinding = () => {
    const first = [...flagged].sort((a, b) => a - b)[0];
    if (first == null) return;
    setOpen(true);
    setPendingJump(first);
  };
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {flagged.size > 0 && (
          <button
            type="button"
            onClick={(e) => {
              // The header itself toggles the card; a badge click means "take me
              // there", which is a different intent and must not also collapse it.
              e.stopPropagation();
              jumpToFirstFinding();
            }}
            title={t("diffViewer.jumpToFinding")}
            style={s.findingBadge}
          >
            <Icon.AlertTriangle size={11} />
            {t("diffViewer.findingCount", { count: flagged.size })}
          </button>
        )}
        {flagged.size > 0 && onOpenFindings && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFindings();
            }}
            title={t("diffViewer.openInFindings")}
            aria-label={t("diffViewer.openInFindings")}
            style={s.findingLink}
          >
            <Icon.ArrowRight size={12} />
          </button>
        )}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const flaggedLine = ln.newNo != null && flagged.has(ln.newNo);
              const body = (
                <CodeLine
                  ln={ln}
                  path={file.path}
                  threads={threadsForLine(ln, matched)}
                  commenting={commenting}
                />
              );
              // Unflagged lines are rendered exactly as before — no wrapper, so a
              // file with no findings is byte-identical to the pre-Smart-Diff view.
              if (!flaggedLine) return <React.Fragment key={i}>{body}</React.Fragment>;
              return (
                <div
                  key={i}
                  id={lineDomId(file.path, ln.newNo!)}
                  style={flashed === ln.newNo ? s.findingLineFlash : s.findingLine}
                >
                  {body}
                </div>
              );
            })
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
