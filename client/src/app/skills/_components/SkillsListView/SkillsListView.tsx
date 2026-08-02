/* /skills — L02 Skills Lab. Card grid over every skill in the workspace, plus
   import-from-URL. Selecting a card opens the Config / Preview editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ErrorState, Skeleton, Badge } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useImportSkill } from "../../../../lib/hooks/conventions";
import { SOURCE_LABEL, s } from "./styles";

export function SkillsListView() {
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const importSkill = useImportSkill();
  const [url, setUrl] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function doImport() {
    setError(null);
    try {
      const skill = await importSkill.mutateAsync({ url: url.trim() });
      setImporting(false);
      setUrl("");
      router.push(`/skills/${skill.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  const list = skills ?? [];

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>Skills</h1>
            <p style={s.subtitle}>
              Reusable rule blocks. A skill linked to an agent is appended to that agent&rsquo;s
              review prompt.
            </p>
          </div>
          <Button kind="secondary" size="sm" icon="Upload" onClick={() => setImporting((v) => !v)}>
            Import from URL
          </Button>
        </div>

        {importing && (
          <div style={s.importRow}>
            <input
              autoFocus
              style={s.importInput}
              placeholder="https://github.com/owner/repo/blob/main/SKILL.md"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && doImport()}
            />
            <Button
              kind="primary"
              size="sm"
              disabled={!url.trim()}
              loading={importSkill.isPending}
              onClick={doImport}
            >
              Import
            </Button>
          </div>
        )}
        {error && <div style={s.error}>{error}</div>}

        {isLoading && (
          <div style={s.grid}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={130} />
            ))}
          </div>
        )}
        {isError && <ErrorState title="Could not load skills" onRetry={() => refetch()} />}

        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title="No skills yet"
            body="Extract conventions from a repository, or import a skill from a URL."
          />
        )}

        <div style={s.grid}>
          {list.map((sk) => (
            <button key={sk.id} style={s.card} onClick={() => router.push(`/skills/${sk.id}`)}>
              <div style={s.cardHead}>
                <span style={s.cardName}>{sk.name}</span>
                {!sk.enabled && (
                  <Badge color="var(--text-muted)" bg="transparent">
                    disabled
                  </Badge>
                )}
              </div>
              <p style={s.cardDesc}>{sk.description}</p>
              <div style={s.cardMeta}>
                <span>{sk.type}</span>
                <span>·</span>
                <span>{SOURCE_LABEL[sk.source] ?? sk.source}</span>
                <span>·</span>
                <span>v{sk.version}</span>
                {sk.evidence_files && sk.evidence_files.length > 0 && (
                  <>
                    <span>·</span>
                    <span>{sk.evidence_files.length} evidence file(s)</span>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
