/* SmartDiffViewer — the PR's files grouped core / wiring / boilerplate and
   ordered by risk, so a reviewer meets business logic before a lock file.
   Reuses the diff-viewer FileCard; the grouping and open/closed policy are the
   only things this adds. */
"use client";

import React from "react";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { DiffCommentApi } from "@/components/diff-viewer";
import { ROLE_META, defaultOpenFor } from "./constants";
import { s } from "./styles";

export function SmartDiffViewer({
  smartDiff,
  files,
  commenting,
  onOpenFinding,
  focus,
}: {
  smartDiff: SmartDiff;
  /** The raw PR files — Smart Diff carries paths and stats, not patch text. */
  files: PrFile[];
  commenting?: DiffCommentApi;
  /**
   * Jump to a flagged line's finding in the Findings tab. Resolving a
   * (path, line) pair to a finding id needs the review data, which this
   * component does not fetch — so the owner does it and passes the handler in.
   */
  onOpenFinding?: (path: string, line: number) => void;
  /**
   * Open one file at a line, matched by path. Passed straight through to the
   * `FileCard`s: the grouping changes which section a file sits in, never
   * whether it can be focused.
   */
  focus?: { file: string; line?: number };
}) {
  // The API returns paths; the patch to render still comes from the PR payload
  // the page already has. Keeping them separate means Smart Diff never has to
  // ship diff text, and the two views render byte-identical file bodies.
  const byPath = React.useMemo(() => {
    const m = new Map<string, PrFile>();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);

  return (
    <div>
      {ROLE_META.map(({ role, label, hint, color }) => {
        const group = smartDiff.groups.find((g) => g.role === role);
        const groupFiles = group?.files ?? [];
        return (
          <section key={role} style={s.group}>
            <header style={s.groupHeader}>
              <span style={s.dot(color)} />
              <span style={s.label}>{label}</span>
              <span style={s.hint}>{hint}</span>
              <span style={s.count}>
                {groupFiles.length} {groupFiles.length === 1 ? "file" : "files"}
              </span>
            </header>
            {groupFiles.length === 0 ? (
              <div style={s.empty}>Nothing in this group.</div>
            ) : (
              <div style={s.files}>
                {groupFiles.map((f) => {
                  const raw = byPath.get(f.path);
                  return (
                    <FileCard
                      key={f.path}
                      // Fall back to a patch-less stub so a file that Smart Diff
                      // knows about but the page has not loaded still renders its
                      // header rather than vanishing from the list.
                      file={raw ?? { path: f.path, additions: f.additions, deletions: f.deletions, patch: null }}
                      commenting={commenting}
                      defaultOpen={defaultOpenFor(role, f.finding_lines.length)}
                      findingLines={f.finding_lines}
                      focus={focus?.file === f.path ? { line: focus.line } : undefined}
                      onOpenFindings={
                        onOpenFinding && f.finding_lines.length > 0
                          ? () => onOpenFinding(f.path, f.finding_lines[0]!)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {smartDiff.split_suggestion.too_big && (
        <div style={s.splitNote}>
          <strong>This PR is large</strong> — {smartDiff.split_suggestion.total_lines} changed
          lines.
          {smartDiff.split_suggestion.proposed_splits.length > 0 && (
            <>
              {" "}
              It could split along:{" "}
              {smartDiff.split_suggestion.proposed_splits.map((p) => p.name).join(", ")}.
            </>
          )}
        </div>
      )}
    </div>
  );
}
