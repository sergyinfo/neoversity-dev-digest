"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import type { Projection } from "@/lib/hooks/project-context";
import { ORIGIN_META, OUTCOME_META } from "./constants";
import { s } from "./styles";

export interface ProjectionSummaryProps {
  /**
   * Whether an agent is currently in view. `false` renders D-11's "choose an
   * agent" copy regardless of `projection` — first page load, or the Skills
   * tab active.
   */
  hasAgent: boolean;
  /**
   * The agent's projection payload, already fetched by the caller (this
   * component does no fetching of its own). `undefined` while loading (with
   * `isLoading`), `null` when unavailable — both render the degraded state
   * required by §9, never a client-summed fallback.
   */
  projection: Projection | null | undefined;
  /** True while the projection is being fetched. */
  isLoading?: boolean;
  /**
   * Linked skills that are disabled and therefore contribute nothing
   * (REQ-6/AC-30). Passed by the caller — S6's `resolveForAgent` filters
   * disabled skills out of `projection.entries` in SQL, so this component has
   * no way to name them from the projection alone.
   */
  disabledSkills?: Pick<Skill, "id" | "name">[];
}

/**
 * The token-cost projection for one agent — shared by the `/context` page's
 * Agents tab and the read-only Context tab in the Agent Editor.
 *
 * A PURE RENDER of the server's projection payload (S14): it never sums
 * `entries[].tokens_estimate` itself. `projected_tokens` and `budget_tokens`
 * come straight from the server, exactly as D-9 requires — a client-side sum
 * would understate the true cost (inherited documents, wrapper overhead,
 * budget elision) in the same direction every time.
 */
export function ProjectionSummary({
  hasAgent,
  projection,
  isLoading,
  disabledSkills = [],
}: ProjectionSummaryProps) {
  const t = useTranslations("context");

  if (!hasAgent) {
    return (
      <div style={s.wrap}>
        <div style={s.state}>
          <p style={s.stateTitle}>{t("projection.noAgent.title")}</p>
          <p style={s.stateBody}>{t("projection.noAgent.body")}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.skeletonRows}>
          <Skeleton width="55%" />
          <Skeleton width="90%" />
          <Skeleton width="75%" />
        </div>
      </div>
    );
  }

  if (!projection) {
    return (
      <div style={s.wrap}>
        <p style={s.stateBody}>{t("projection.unavailable")}</p>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.totalRow}>
        <span className="tnum" style={s.total}>
          {t("budgetFraction", {
            used: projection.projected_tokens.toLocaleString(),
            total: projection.budget_tokens.toLocaleString(),
          })}
        </span>
        <span style={s.estimateMarker}>{t("estimateMarker")}</span>
      </div>

      <ul style={s.entries}>
        {projection.entries.map((entry) => {
          const origin = ORIGIN_META[entry.origin];
          const outcome = OUTCOME_META[entry.outcome];
          return (
            <li key={entry.path} style={s.entryRow}>
              <span className="mono" style={s.path} title={entry.path}>
                {entry.path}
              </span>
              <Badge icon={origin.icon} color={origin.color} bg={origin.bg}>
                {t(origin.labelKey)}
              </Badge>
              <Badge icon={outcome.icon} color={outcome.color} bg={outcome.bg}>
                {t(outcome.labelKey)}
              </Badge>
              {entry.tokens_estimate != null && (
                <span className="tnum" style={s.entryTokens}>
                  {t("tokensTotal", { count: entry.tokens_estimate.toLocaleString() })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {disabledSkills.length > 0 && (
        <div style={s.disabledSkills}>
          <span style={s.disabledSkillsLabel}>{t("projection.disabledSkillsLabel")}</span>
          <ul style={s.disabledSkillsList}>
            {disabledSkills.map((sk) => (
              <li key={sk.id} style={s.disabledSkillItem}>
                {t("projection.notContributing", { name: sk.name })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
