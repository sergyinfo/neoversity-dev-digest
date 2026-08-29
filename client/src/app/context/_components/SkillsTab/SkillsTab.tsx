"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { useSkills } from "@/lib/hooks/conventions";
import { useAttachContextDoc, useDetachContextDoc } from "@/lib/hooks/project-context";
import { DocumentList, useTargetAttachments } from "../DocumentList";
import { s } from "./styles";

export function SkillsTab({ repoId, docs }: { repoId: string; docs: SpecFile[] }) {
  const t = useTranslations("context");
  const tSkills = useTranslations("skills");
  const qc = useQueryClient();

  const skills = useSkills();
  const [selected, setSelected] = React.useState<string | null>(null);
  const skillId = selected ?? skills.data?.[0]?.id ?? null;

  const attachments = useTargetAttachments("skill", skillId);
  const attach = useAttachContextDoc();
  const detach = useDetachContextDoc();

  const attachedPaths = React.useMemo(
    () => new Set((attachments.data ?? []).map((a) => a.path)),
    [attachments.data],
  );

  /**
   * D-10's "contribution figure": what this skill adds to every agent that
   * has it linked and enabled — documents plus wrapper, no section heading,
   * no budget fraction, no drop marking (those are unknowable at skill
   * level; only the inheriting agent's projection has a budget).
   *
   * No `GET /skills/:id/context/contribution` route exists — S8 only built
   * the per-AGENT projection (`GET /agents/:id/context/projection`); nothing
   * in this feature computes a skill-level, wrapper-inclusive figure
   * server-side. Rather than reimplement that arithmetic client-side (the
   * exact trap D-9 warns about for the agent case), this sums each
   * document's own server-computed `tokens_estimate` — already honest,
   * already labelled an estimate — and does NOT add a wrapper allowance,
   * so the true per-agent contribution is somewhat higher than this number.
   * Flagged in the implementer report as a residual gap for a follow-up
   * step that gives Skills a projection-shaped endpoint.
   */
  const contribution = React.useMemo(() => {
    let total = 0;
    let any = false;
    for (const doc of docs) {
      if (!attachedPaths.has(doc.path)) continue;
      if (doc.tokens_estimate == null) continue;
      total += doc.tokens_estimate;
      any = true;
    }
    return any ? total : null;
  }, [docs, attachedPaths]);

  function toggle(doc: SpecFile, attachIt: boolean) {
    if (!skillId) return;
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: ["context-attachments", "skill", skillId] });
    if (attachIt) {
      attach.mutate(
        { path: doc.path, repo_id: repoId, target_kind: "skill", target_id: skillId },
        { onSuccess: invalidate },
      );
      return;
    }
    const row = (attachments.data ?? []).find((a) => a.path === doc.path);
    if (!row) return;
    detach.mutate(
      { id: row.id, repo_id: repoId, target_kind: "skill", target_id: skillId },
      { onSuccess: invalidate },
    );
  }

  if (skills.isLoading) {
    return <Skeleton height={220} />;
  }

  if ((skills.data ?? []).length === 0) {
    return (
      <EmptyState icon="Sparkles" title={tSkills("page.empty.title")} body={tSkills("page.empty.body")} />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.selector} role="listbox" aria-label={t("tabs.skills")}>
        {(skills.data ?? []).map((sk) => (
          <div
            key={sk.id}
            role="option"
            aria-selected={sk.id === skillId}
            tabIndex={0}
            style={s.selectorItem(sk.id === skillId)}
            onClick={() => setSelected(sk.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelected(sk.id);
            }}
          >
            {sk.name}
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

        <div style={s.contribution}>
          <span className="tnum" style={s.contributionValue}>
            {t("projection.skillContribution", { count: (contribution ?? 0).toLocaleString() })}
          </span>
          <span style={s.estimateMarker}>{t("estimateMarker")}</span>
        </div>
      </div>
    </div>
  );
}
