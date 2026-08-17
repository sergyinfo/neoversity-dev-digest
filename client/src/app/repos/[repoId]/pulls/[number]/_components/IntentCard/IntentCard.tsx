"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { IntentConfidence, PrIntentRecord } from "@/lib/types";
import { useRecomputeIntent } from "@/lib/hooks/intent";
import { CONFIDENCE_META, SOURCE_ICON, SOURCE_ORDER } from "./constants";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null | undefined;
  intent: PrIntentRecord | null | undefined;
  /** True while the PR detail (which carries the intent) is still loading. */
  loading?: boolean;
}

/**
 * The PR's derived intent, above the description on the Overview tab.
 *
 * Three states, all real: derived (the card), never derived (an empty state with
 * a Derive action), and loading. Absence is a genuine state here — intent
 * derivation is best-effort and is skipped entirely in test environments — so it
 * gets its own affordance rather than rendering a blank card.
 */
export function IntentCard({ prId, intent, loading }: IntentCardProps) {
  const t = useTranslations("prReview");
  const recompute = useRecomputeIntent(prId);

  if (loading) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <div style={s.skeletonRows}>
          <Skeleton width="80%" />
          <Skeleton width="60%" />
          <Skeleton width="45%" />
        </div>
      </Card>
    );
  }

  if (!intent) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <EmptyState
          icon="Target"
          title={t("intent.emptyTitle")}
          body={t("intent.emptyBody")}
          cta={t("intent.derive")}
          onCta={() => recompute.mutate()}
          ctaLoading={recompute.isPending}
        />
        {recompute.isError && <div style={s.empty}>{t("intent.failed")}</div>}
      </Card>
    );
  }

  const band: IntentConfidence = intent.confidence ?? "low";
  const meta = CONFIDENCE_META[band];
  const sources = SOURCE_ORDER.filter((src) => intent.sources?.includes(src));

  return (
    <Card>
      <SectionLabel
        icon="Target"
        right={
          <Badge color={meta.color} bg={meta.bg} icon={meta.icon}>
            {t(`intent.confidence.${meta.labelKey}`)}
          </Badge>
        }
      >
        {t("intent.title")}
      </SectionLabel>

      <p style={s.quote}>{`“${intent.intent}”`}</p>

      <div style={s.scopeGrid}>
        <ScopeList
          label={t("intent.inScope")}
          items={intent.in_scope}
          color="var(--ok)"
          itemColor="var(--text-secondary)"
          icon={<Icon.Check size={13} />}
          emptyLabel={t("intent.noneListed")}
        />
        <ScopeList
          label={t("intent.outOfScope")}
          items={intent.out_of_scope}
          color="var(--text-muted)"
          itemColor="var(--text-muted)"
          icon={<Icon.X size={13} />}
          emptyLabel={t("intent.noneListed")}
        />
      </div>

      <div style={s.footer}>
        {sources.length > 0 && (
          <>
            <span style={s.sourcesLabel}>{t("intent.derivedFrom")}</span>
            {sources.map((src) => (
              <Badge key={src} icon={SOURCE_ICON[src]}>
                {t(`intent.source.${src}`)}
              </Badge>
            ))}
          </>
        )}
        <span style={s.spacer} />
        {intent.model && <span style={s.age}>{intent.model}</span>}
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          onClick={() => recompute.mutate()}
          loading={recompute.isPending}
        >
          {t("intent.recompute")}
        </Button>
      </div>
    </Card>
  );
}

function ScopeList({
  label,
  items,
  color,
  itemColor,
  icon,
  emptyLabel,
}: {
  label: string;
  items: string[];
  color: string;
  itemColor: string;
  icon: React.ReactNode;
  emptyLabel: string;
}) {
  return (
    <div>
      <div style={s.scopeHead(color)}>
        {icon}
        {label}
      </div>
      {items.length === 0 ? (
        <div style={s.empty}>{emptyLabel}</div>
      ) : (
        <ul style={s.scopeList}>
          {items.map((item, i) => (
            <li key={i} style={s.scopeItem(itemColor)}>
              <span style={s.bullet(color)}>·</span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
