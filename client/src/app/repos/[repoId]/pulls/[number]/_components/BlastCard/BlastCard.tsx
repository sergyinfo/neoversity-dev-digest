"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, EmptyState, Icon, MonoLink, SectionLabel, Skeleton } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";
import { useBlast, type BlastResponse } from "@/lib/hooks/blast";
import { BlastGraph } from "./BlastGraph";
import { MAX_SYMBOLS_IN_TREE } from "./constants";
import { s } from "./styles";

/**
 * Blast Radius — what else this diff can touch.
 *
 * Every node comes from the prebuilt code index; nothing here is inferred and
 * no model is involved. Three non-data states are kept visually distinct on
 * purpose:
 *
 *  - **empty**    the index is good and there genuinely are no downstream callers
 *  - **partial**  the index is incomplete; the map is shown WITH a caveat
 *  - **degraded** there is no usable index; the impact is UNKNOWN
 *
 * Collapsing degraded into empty would tell a reviewer "this change is safe"
 * exactly when we cannot know that, which is the one failure mode this feature
 * must not have.
 */
export function BlastCard({ prId }: { prId: string | null | undefined }) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = useBlast(prId);
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [priorOpen, setPriorOpen] = React.useState(false);

  if (isLoading) {
    return (
      <Card>
        <SectionLabel icon="Zap">Blast Radius</SectionLabel>
        <div style={s.skeletonRows}>
          <Skeleton width="70%" />
          <Skeleton width="50%" />
        </div>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <SectionLabel icon="Zap">Blast Radius</SectionLabel>
        <EmptyState icon="AlertTriangle" title="Could not load the impact map" />
      </Card>
    );
  }

  const { counts, map, state } = data;
  const withCallers = map.downstream.filter((d) => d.callers.length > 0);
  const shown = withCallers.slice(0, MAX_SYMBOLS_IN_TREE);

  return (
    <Card>
      <div style={s.head}>
        <SectionLabel icon="Zap">Blast Radius</SectionLabel>
        <div style={s.stats}>
          <Stat n={counts.symbols} label={t("stat.symbols")} />
          <Stat n={counts.callers} label={t("stat.callers")} />
          <Stat n={counts.endpoints} label={t("stat.endpoints")} />
          {/* Hidden at zero rather than shown as "0 cron": this repository
              enqueues jobs with constants, which the indexer's string-literal
              matcher cannot see. An always-visible zero would read as a fact. */}
          {counts.crons > 0 && <Stat n={counts.crons} label={t("stat.crons")} />}
          <div style={s.viewToggle} role="group">
            {(["tree", "graph"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                style={s.viewBtn(view === v)}
              >
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {state === "degraded" && (
        <div style={s.banner("bad")}>
          <Icon.AlertTriangle size={14} />
          <span>
            The impact of this change is <strong>unknown</strong> — this repository has no usable
            code index{data.reason ? ` (${data.reason})` : ""}. This is not the same as “nothing is
            affected”. Re-analyze the repository to build one.
          </span>
        </div>
      )}

      {state === "partial" && (
        <div style={s.banner("warn")}>
          <Icon.AlertTriangle size={14} />
          <span>
            The code index is incomplete{data.reason ? ` — ${data.reason}` : ""}, so callers may be
            missing from this map.
          </span>
        </div>
      )}

      {state !== "degraded" && withCallers.length === 0 && (
        <EmptyState
          icon="Check"
          title={t("noDownstream", { count: counts.symbols })}
        />
      )}

      {view === "graph" && state !== "degraded" && (
        <div style={s.graphWrap}>
          <BlastGraph
            map={map}
            ariaLabel={t("graph.ariaLabel")}
            emptyLabel={t("graph.empty")}
          />
        </div>
      )}

      {view === "tree" &&
        shown.map((d) => {
          const isOpen = open[d.symbol] ?? false;
          return (
            <div key={d.symbol}>
              <button
                type="button"
                style={s.symbolRow}
                onClick={() => setOpen((o) => ({ ...o, [d.symbol]: !isOpen }))}
                aria-expanded={isOpen}
              >
                <span style={s.symbolName}>
                  {isOpen ? <Icon.ChevronDown size={13} /> : <Icon.ChevronRight size={13} />}
                  <code>{d.symbol}()</code>
                </span>
                <span style={s.callerCount}>{t("callerCount", { count: d.callers.length })}</span>
              </button>

              {isOpen && (
                <>
                  <div style={s.callerList}>
                    {d.callers.map((c) => (
                      <div key={`${c.file}:${c.line}`} style={s.callerLine}>
                        <span aria-hidden>↳</span>
                        <CallerLink blast={data} file={c.file} line={c.line} />
                        <span style={s.callerEnclosing}>({c.name})</span>
                      </div>
                    ))}
                  </div>
                  {(d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
                    <div style={s.badgeRow}>
                      {d.endpoints_affected.map((e) => (
                        <Badge key={e} icon="Globe" mono>
                          {e}
                        </Badge>
                      ))}
                      {d.crons_affected.map((c) => (
                        <Badge key={c} icon="Clock" mono>
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

      {data.prior_prs.length > 0 && (
        <>
          <button
            type="button"
            style={s.priorHead}
            onClick={() => setPriorOpen((v) => !v)}
            aria-expanded={priorOpen}
          >
            {priorOpen ? <Icon.ChevronDown size={13} /> : <Icon.ChevronRight size={13} />}
            Prior PRs touching these files ({data.prior_prs.length})
          </button>
          {priorOpen && (
            <div style={s.priorList}>
              {data.prior_prs.map((p) => (
                <div key={p.number}>
                  <MonoLink href={`https://github.com/${data.repo_full_name}/pull/${p.number}`}>
                    #{p.number} {p.title}
                  </MonoLink>
                  <div style={s.priorFiles}>{p.overlapping_files.join(", ")}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span style={s.stat}>
      <span style={s.statNum}>{n}</span>
      {label}
    </span>
  );
}

/**
 * A caller's `file:line`, pinned to the sha the INDEX was built from.
 *
 * Not the PR head: the line number comes from the indexed tree, and the head may
 * have moved lines since. Linking a caller to the head sends the reviewer to a
 * plausible-looking but wrong line, which is worse than not linking at all —
 * so when nothing is indexed the path renders as plain text instead.
 */
function CallerLink({
  blast,
  file,
  line,
}: {
  blast: BlastResponse;
  file: string;
  line: number;
}) {
  const label = `${file}:${line}`;
  if (!blast.indexed_sha) {
    return (
      <span className="mono" title="No indexed revision — cannot link to an exact line">
        {label}
      </span>
    );
  }
  return (
    <MonoLink href={githubBlobUrl(blast.repo_full_name, blast.indexed_sha, file, line)}>
      {label}
    </MonoLink>
  );
}
