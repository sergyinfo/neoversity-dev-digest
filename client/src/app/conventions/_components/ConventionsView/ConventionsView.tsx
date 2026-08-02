/* /conventions — L02 Conventions Extractor. Run the scan, judge each candidate,
   then merge the accepted ones into a skill. */
"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import {
  useConventions,
  useExtractConventions,
  useSetConventionStatus,
  useEditConvention,
} from "../../../../lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "./styles";

export function ConventionsView() {
  const { activeRepo } = useActiveRepo();
  const repo = activeRepo;
  const repoId = repo?.id ?? null;

  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const setStatus = useSetConventionStatus(repoId);
  const editRule = useEditConvention(repoId);
  const [creating, setCreating] = React.useState(false);

  const list = candidates ?? [];
  const accepted = list.filter((c) => c.status === "accepted");

  if (!repoId) {
    return (
      <AppShell crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}>
        <div style={s.page}>
          <EmptyState icon="Folder" title="No repository selected" body="Pick a repo to scan." />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}>
      {creating && <CreateSkillModal repoId={repoId} onClose={() => setCreating(false)} />}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              Conventions in <span style={s.repoName}>{repo?.name ?? "…"}</span>
            </h1>
            <p style={s.subtitle}>
              Configs and the most-depended-on files are sampled in code; one cheap model call
              proposes rules; every candidate is then checked against the real file and dropped if
              its evidence does not match.
            </p>
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={extract.isPending}
            onClick={() => extract.mutate()}
          >
            {list.length > 0 ? "Re-scan" : "Scan"}
          </Button>
        </div>

        {extract.isError && (
          <div style={{ ...s.counts, color: "var(--crit)", marginBottom: 12 }}>
            {extract.error instanceof Error ? extract.error.message : "Extraction failed"}
          </div>
        )}

        {extract.data && (
          // The drop count is the honest quality signal for the run — a scan that
          // proposed 8 and kept 2 says something a list of 2 cards does not.
          <div style={{ ...s.counts, marginBottom: 12 }}>
            Last scan proposed <b>{extract.data.proposed}</b>, kept <b>{extract.data.verified}</b>
            {extract.data.dropped > 0 && (
              <> · dropped <b>{extract.data.dropped}</b> for unverifiable evidence</>
            )}
            {extract.data.merged > 0 && (
              <> · merged <b>{extract.data.merged}</b> duplicate(s)</>
            )}
            .
          </div>
        )}

        {list.length > 0 && (
          <div style={s.toolbar}>
            <span style={s.counts}>
              {accepted.length} of {list.length} accepted
            </span>
            <div style={s.toolbarRight}>
              <Button
                kind="ghost"
                size="sm"
                icon="Check"
                onClick={() =>
                  list
                    .filter((c) => c.status !== "accepted")
                    .forEach((c) => setStatus.mutate({ id: c.id, status: "accepted" }))
                }
              >
                Accept all
              </Button>
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                disabled={accepted.length === 0}
                onClick={() => setCreating(true)}
              >
                Create skill
              </Button>
            </div>
          </div>
        )}

        {isLoading && (
          <div style={s.list}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={150} />
            ))}
          </div>
        )}

        {isError && <ErrorState title="Could not load conventions" onRetry={() => refetch()} />}

        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title="No conventions yet"
            body="Run a scan to extract house conventions from this repository."
          />
        )}

        <div style={s.list}>
          {list.map((c) => (
            <ConventionCard
              key={c.id}
              c={c}
              repoFullName={repo?.full_name}
              sha={repo?.default_branch}
              pending={setStatus.isPending}
              onAccept={() => setStatus.mutate({ id: c.id, status: "accepted" })}
              onReject={() => setStatus.mutate({ id: c.id, status: "rejected" })}
              onEditRule={(rule) => editRule.mutate({ id: c.id, rule })}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
