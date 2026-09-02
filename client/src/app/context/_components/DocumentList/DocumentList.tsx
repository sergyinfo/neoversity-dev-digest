"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Toggle } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { middleTruncate } from "./constants";
import { s } from "./styles";

export interface DocumentListProps {
  docs: SpecFile[];
  /**
   * The current target's attached paths, when a target (agent or skill) is
   * in view. Absent ⇒ the list renders read-only, no `Toggle` per row —
   * used by the top-of-page listing, which is target-agnostic.
   */
  attachedPaths?: Set<string>;
  /** Fires on a toggle click; absent alongside `attachedPaths` keeps rows read-only. */
  onToggle?: (doc: SpecFile, attach: boolean) => void;
  /** True while an attach/detach mutation for this target is in flight. */
  toggleBusy?: boolean;
}

/**
 * The discovered-document list — one row per `SpecFile`, shared by the
 * page-level listing and both tabs' attach views (`attachedPaths`/`onToggle`
 * opt a row into a `Toggle`, per D-1).
 *
 * Every number rendered here (`tokens_estimate`, `used_by_count`) comes
 * straight from the server (REQ-3, REQ-9) — this component computes nothing.
 */
export function DocumentList({ docs, attachedPaths, onToggle, toggleBusy }: DocumentListProps) {
  const t = useTranslations("context");

  return (
    <ul style={s.list}>
      {docs.map((doc) => {
        const attached = attachedPaths?.has(doc.path) ?? false;
        return (
          <li key={doc.path} style={s.row}>
            <span style={s.path} title={doc.path}>
              <span style={s.srOnly}>{doc.path}</span>
              <span aria-hidden="true">{middleTruncate(doc.path)}</span>
            </span>

            <div style={s.meta}>
              {doc.over_cap && (
                // No i18n key exists for a per-document over-cap marker (only
                // `capped.*`, which describes the whole LIST hitting its cap —
                // a different thing, NFR-1). Icon-only, so nothing un-keyed
                // is rendered as visible copy.
                <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg, var(--bg-hover))" />
              )}

              <Badge icon="Users" color="var(--text-muted)">
                {doc.used_by_count ?? "—"}
              </Badge>

              {doc.tokens_estimate != null && (
                <span className="tnum" style={s.tokens}>
                  {t("tokensTotal", { count: doc.tokens_estimate.toLocaleString() })}
                  <span style={s.estimateMarker}>{t("estimateMarker")}</span>
                </span>
              )}

              {attachedPaths && onToggle && (
                <Toggle
                  on={attached}
                  onChange={(v) => !toggleBusy && onToggle(doc, v)}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
