"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentSkills, useSkills } from "@/lib/hooks/conventions";
import {
  useAgentContextProjection,
  useAttachContextDoc,
  useDetachContextDoc,
} from "@/lib/hooks/project-context";
import { ProjectionSummary } from "@/components/ProjectionSummary";
import { DocumentList, useTargetAttachments } from "../DocumentList";
import { s } from "./styles";

export function AgentsTab({ repoId, docs }: { repoId: string; docs: SpecFile[] }) {
  const t = useTranslations("context");
  const tAgents = useTranslations("agents");
  const qc = useQueryClient();

  const agents = useAgents();
  const [selected, setSelected] = React.useState<string | null>(null);
  const agentId = selected ?? agents.data?.[0]?.id ?? null;

  const attachments = useTargetAttachments("agent", agentId);
  const projection = useAgentContextProjection(agentId, repoId);
  const allSkills = useSkills();
  const agentSkills = useAgentSkills(agentId);
  const attach = useAttachContextDoc();
  const detach = useDetachContextDoc();

  /**
   * Attachments belong to a (repo, path) PAIR, not to a path (fix-brief F4).
   *
   * `listForTarget` returns every attachment on this agent across ALL
   * repositories, and the document list on screen is this repo's. Comparing on
   * `path` alone rendered the toggle ON for a document attached from a
   * DIFFERENT repo — so this repo's copy could not be attached at all, and
   * switching the toggle off detached the other repository's row.
   */
  const attachedPaths = React.useMemo(
    () =>
      new Set(
        (attachments.data ?? []).filter((a) => a.repo_id === repoId).map((a) => a.path),
      ),
    [attachments.data, repoId],
  );

  // REQ-6/AC-30: `resolveForAgent` filters disabled skills out of the
  // projection in SQL, so a disabled linked skill never reaches `entries` —
  // this component composes it from the two hooks `SkillsTab.tsx` (agent
  // editor) already uses, exactly as the ProjectionSummary contract expects.
  const disabledSkills = React.useMemo(() => {
    const byId = new Map((allSkills.data ?? []).map((sk) => [sk.id, sk]));
    return (agentSkills.data ?? [])
      .map((link) => byId.get(link.skill_id))
      .filter((sk): sk is NonNullable<typeof sk> => !!sk && !sk.enabled)
      .map((sk) => ({ id: sk.id, name: sk.name }));
  }, [allSkills.data, agentSkills.data]);

  function toggle(doc: SpecFile, attachIt: boolean) {
    if (!agentId) return;
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: ["context-attachments", "agent", agentId] });
    if (attachIt) {
      attach.mutate(
        { path: doc.path, repo_id: repoId, target_kind: "agent", target_id: agentId },
        { onSuccess: invalidate },
      );
      return;
    }
    // Same pairing on the way out: without `repo_id` this DELETEs an
    // attachment belonging to a repository the user is not looking at (F4).
    const row = (attachments.data ?? []).find(
      (a) => a.path === doc.path && a.repo_id === repoId,
    );
    if (!row) return;
    detach.mutate(
      { id: row.id, repo_id: repoId, target_kind: "agent", target_id: agentId },
      { onSuccess: invalidate },
    );
  }

  if (agents.isLoading) {
    return <Skeleton height={220} />;
  }

  if ((agents.data ?? []).length === 0) {
    return (
      <EmptyState icon="Cpu" title={tAgents("list.emptyTitle")} body={tAgents("list.emptyBody")} />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.selector} role="listbox" aria-label={t("tabs.agents")}>
        {(agents.data ?? []).map((a) => (
          <div
            key={a.id}
            role="option"
            aria-selected={a.id === agentId}
            tabIndex={0}
            style={s.selectorItem(a.id === agentId)}
            onClick={() => setSelected(a.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelected(a.id);
            }}
          >
            {a.name}
          </div>
        ))}
      </div>

      <div style={s.main}>
        <div style={s.docsCard}>
          <DocumentList
            docs={docs}
            attachedPaths={attachedPaths}
            onToggle={toggle}
            toggleBusy={attach.isPending || detach.isPending}
          />
        </div>

        {(attach.isError || detach.isError) && (
          <div role="alert" style={{ color: "var(--crit)", fontSize: 12.5 }}>
            {(attach.error ?? detach.error) instanceof Error
              ? (attach.error ?? detach.error)!.message
              : "Could not update this attachment"}
          </div>
        )}

        <div style={s.projectionCard}>
          <ProjectionSummary
            hasAgent={!!agentId}
            projection={projection.data}
            isLoading={projection.isLoading}
            disabledSkills={disabledSkills}
          />
        </div>
      </div>
    </div>
  );
}
