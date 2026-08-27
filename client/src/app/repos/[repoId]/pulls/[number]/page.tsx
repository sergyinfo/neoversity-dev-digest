/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { lineDomId } from "@/components/diff-viewer/helpers";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
  useInvalidatePrReviewData,
} from "../../../../../lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateReviewData = useInvalidatePrReviewData(prId);
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setTab = (t: string) => setParam("tab", t);

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  /**
   * Smart Diff → Findings. Resolves a flagged (path, line) back to the finding
   * it came from and opens the Findings tab on it.
   *
   * Only the LATEST run is searched, because that is the run Smart Diff's
   * `finding_lines` came from; scanning every run could land on a finding from
   * a superseded review that no longer matches what the badge counted.
   *
   * `push`, not `replace`: this is a navigation the reader chose, so Back should
   * return them to the diff they were reading. Both params move in one call so
   * it costs one history entry, not two.
   */
  const openFindingFromDiff = (path: string, line: number) => {
    const latest = runs[0]?.findings ?? [];
    const hit =
      latest.find((f) => f.file === path && f.start_line === line) ??
      latest.find((f) => f.file === path);
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", "findings");
    if (hit) sp.set("finding", hit.id);
    else sp.delete("finding");
    router.push(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
  };

  // Scroll the targeted finding into view once the Findings tab has rendered it.
  // `FindingCard` already carries a `data-finding-id` anchor, so this needs no
  // prop drilling through FindingsTab → ReviewRunAccordion → FindingsPanel.
  // It retries briefly because the card mounts a frame or two after the param
  // changes, and its run's accordion may still be opening.
  const focusFindingId = search.get("finding");
  React.useEffect(() => {
    if (!focusFindingId || tab !== "findings") return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.querySelector(`[data-finding-id="${focusFindingId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        window.clearInterval(timer);
      } else if (++tries > 20) {
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [focusFindingId, tab, findingsCount]);

  /**
   * Why & Risk → Files changed. The mirror image of `openFindingFromDiff`
   * above: a review-focus entry names a file and (usually) a line, and this
   * turns that into the one navigation that shows it.
   *
   * `push`, and all three params in a SINGLE call, for the same reasons as the
   * jump above — the reader chose this, so Back must return them to the
   * Overview tab they left, and setting `tab`, `file` and `line` separately
   * would cost three history entries for one click.
   *
   * `line` is optional: a focus entry is allowed to name a file only, in which
   * case the tab opens on the file with nothing to scroll to.
   *
   * Its caller is the Why & Risk card's review-focus list on the Overview tab,
   * reached through `OverviewTab`'s `onOpenFile`.
   */
  const openFileFromBrief = (path: string, line?: number) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", "diff");
    sp.set("file", path);
    if (line != null) sp.set("line", String(line));
    else sp.delete("line");
    router.push(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
  };

  const focusFile = search.get("file");
  const focusLineParam = search.get("line");
  // A hand-edited `?line=` is a value, not a crash: anything that is not a
  // positive integer is treated as "no line" and the file simply opens.
  const focusLine =
    focusLineParam && /^\d+$/.test(focusLineParam) ? Number(focusLineParam) : null;
  const diffFocus = focusFile ? { file: focusFile, line: focusLine ?? undefined } : undefined;
  const focusInDiff = !!focusFile && (pr?.files ?? []).some((f) => f.path === focusFile);

  /**
   * Clear `file`/`line` once the jump has landed, so a later re-render — or a
   * Back into this URL — does not scroll the reader away again, and the address
   * bar stops advertising a target that has already been consumed.
   *
   * `replace`, not `push`: consuming a param is not a navigation the reader
   * made, and Back must still return them to the Overview tab.
   *
   * It polls for the same reason the findings jump does — the line mounts a
   * frame or two later, and Smart Diff can swap the file list underneath it
   * when the grouping arrives. A file this PR did not return is left alone:
   * there is nothing to land on, and the Files tab keeps saying so.
   */
  React.useEffect(() => {
    if (!focusFile || tab !== "diff" || !focusInDiff) return;
    const clear = () => {
      const sp = new URLSearchParams(search.toString());
      sp.delete("file");
      sp.delete("line");
      router.replace(
        `/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`,
      );
    };
    let tries = 0;
    const timer = window.setInterval(() => {
      const landed =
        focusLine == null || document.getElementById(lineDomId(focusFile, focusLine)) != null;
      if (landed || ++tries > 20) {
        window.clearInterval(timer);
        clear();
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [focusFile, focusLine, focusInDiff, tab]);

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            prBody={pr.body}
            intent={pr.intent}
            // The detail payload carries the intent, so a refetch (e.g. after a
            // recompute) shows the skeleton rather than the previous intent.
            intentLoading={detailLoading}
            onOpenFile={openFileFromBrief}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              // Refreshes the findings AND everything derived from them — the
              // Smart Diff badges appear here without a reload.
              invalidateReviewData();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            onOpenFinding={openFindingFromDiff}
            focus={diffFocus}
            canComment={pr.status === "open"}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
