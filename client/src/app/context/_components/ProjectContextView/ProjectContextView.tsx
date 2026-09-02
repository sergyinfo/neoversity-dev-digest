"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextDocs } from "@/lib/hooks/project-context";
import { DocumentList } from "../DocumentList";
import { AgentsTab } from "../AgentsTab";
import { SkillsTab } from "../SkillsTab";
import type { ContextTabKey } from "./constants";
import { formatLastSynced } from "./constants";
import { s } from "./styles";

/**
 * `/context` — REQ-8. Discovered documents, an Agents tab and a Skills tab
 * for attaching them (D-1). Attaching happens only here; the read-only
 * Context tab in the Agent Editor (S16) reuses `ProjectionSummary` against
 * the same projection endpoint rather than duplicating an attach control.
 */
export function ProjectContextView() {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;
  const { data, isLoading, isError, refetch } = useContextDocs(repoId);
  const [tab, setTab] = React.useState<ContextTabKey>("agents");

  const crumb = [{ label: t("title") }];

  if (!repoId) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState
            icon="Folder"
            title="No repository selected"
            body="Pick a repo to see its project context."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("title")}</h1>
          {data && <span style={s.synced}>{formatLastSynced(data.last_synced_at)}</span>}
        </div>

        {isLoading && <Skeleton height={220} />}

        {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

        {/* F3 — `not_cloned` and `clone_missing` are distinct, non-error empty
            states: a deleted clone is not an error toast. The bodies come
            from two separate `reason.*` keys that must never share copy. */}
        {data && data.reason != null && (
          <EmptyState icon="Folder" title={t("empty.title")} body={t(`reason.${data.reason}`)} />
        )}

        {data && data.reason == null && data.files.length === 0 && (
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        )}

        {data && data.reason == null && data.files.length > 0 && (
          <>
            {data.capped && (
              <div style={s.cappedNotice}>
                <strong>{t("capped.title")}</strong>
                <span>{t("capped.body")}</span>
              </div>
            )}

            <div style={s.section}>
              <div style={s.sectionLabel}>{t("title")}</div>
              <DocumentList docs={data.files} />
            </div>

            <div style={s.tabsBar}>
              <Tabs
                tabs={[
                  { key: "agents", label: t("tabs.agents") },
                  { key: "skills", label: t("tabs.skills") },
                ]}
                value={tab}
                onChange={(k) => setTab(k as ContextTabKey)}
              />
            </div>

            <div style={s.tabBody}>
              {tab === "agents" ? (
                <AgentsTab repoId={repoId} docs={data.files} />
              ) : (
                <SkillsTab repoId={repoId} docs={data.files} />
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
