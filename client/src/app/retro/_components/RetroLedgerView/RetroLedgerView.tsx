"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useRetroLedger } from "@/lib/hooks/retro";
import { forDisplay, formatUpdatedAt, hasEntries } from "./constants";
import { s } from "./styles";

/**
 * `/retro` — a read-only viewer for the committed `docs/retro/ledger.md`.
 *
 * It reads one known file and renders it, so the ledger is visible alongside
 * the rest of the app instead of only in a text editor. It does NOT run a
 * retro and does not write one: `/retro` is a Claude Code slash command that a
 * human types, and there is deliberately no button here that starts one.
 *
 * Three distinct states, which must not share copy:
 *  - no file at all — nobody has typed `/retro` in this checkout yet;
 *  - a file with a preamble and zero entries — TODAY'S state, and therefore
 *    the first thing anyone opens, not an edge case. The preamble is real,
 *    committed content and is rendered as such; the "nothing recorded yet"
 *    panel sits below it rather than replacing it;
 *  - a file with entries — just render it.
 */
export function RetroLedgerView() {
  const t = useTranslations("retro");
  const { data, isLoading, isError, refetch } = useRetroLedger();

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbRetro") }];
  const stamp = formatUpdatedAt(data?.updated_at ?? null);
  const path = data?.path ?? "docs/retro/ledger.md";

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.titleRow}>
            <h1 style={s.h1}>{t("page.title")}</h1>
            {data && (
              <span style={s.stamp}>
                {stamp ? t("page.updatedAt", { date: stamp }) : t("page.updatedUnknown")}
              </span>
            )}
          </div>
          <p style={s.subtitle}>{t("page.subtitle")}</p>
          {data && <span style={s.filePath}>{t("page.fileLabel", { path })}</span>}
        </div>

        {isLoading && <Skeleton height={220} />}

        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {/* No file — a normal state in a fresh checkout, not an error. The body
            has to carry the whole explanation, since there is no preamble on
            disk to render underneath it. */}
        {data && !data.exists && (
          <EmptyState
            icon="Clock"
            title={t("empty.noFileTitle")}
            body={t("empty.noFileBody", { path })}
          />
        )}

        {/* The file's own markdown, verbatim. Rendered whenever there IS a file,
            including the zero-entry case: the header and scope note it opens
            with are genuine content, and hiding them to show an empty state
            would be throwing away the most useful thing on the page. */}
        {data && data.exists && forDisplay(data.content).trim().length > 0 && (
          <div style={s.card}>
            <Markdown>{forDisplay(data.content)}</Markdown>
          </div>
        )}

        {/* A file that exists but has recorded nothing yet. Distinct copy from
            the no-file case above — "the ledger has no entries" and "there is
            no ledger" are different facts. */}
        {data && data.exists && !hasEntries(data.content) && (
          <EmptyState
            icon="Clock"
            title={t("empty.noEntriesTitle")}
            body={t("empty.noEntriesBody")}
          />
        )}

        {/* The scope boundary, restated in the UI because it is the mistake this
            ledger actually attracts: codebase findings filed here instead of in
            a package's INSIGHTS.md. */}
        {data && (
          <div style={s.scopeNote}>
            <span style={s.scopeTitle}>{t("scope.title")}</span>
            <span style={s.scopeBody}>{t("scope.body")}</span>
          </div>
        )}
      </div>
    </AppShell>
  );
}
