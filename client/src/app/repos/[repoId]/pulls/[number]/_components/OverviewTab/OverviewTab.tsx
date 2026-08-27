"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrIntentRecord } from "@/lib/types";
import { WhyRiskCard } from "../WhyRiskCard";
import { IntentCard } from "../IntentCard";
import { BlastCard } from "../BlastCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  prBody: string | null | undefined;
  intent: PrIntentRecord | null | undefined;
  intentLoading?: boolean;
  /** Jump to a file (and line) on the Files tab — the review-focus list's only
      consumer. Supplied by the PR page as `openFileFromBrief`. */
  onOpenFile?: (path: string, line?: number) => void;
}

export function OverviewTab({
  prId,
  prBody,
  intent,
  intentLoading,
  onOpenFile,
}: OverviewTabProps) {
  return (
    <>
      {/* Why & Risk first: it is the reviewer's entry point — what the PR does,
          why, and what to read first. It owns its own query, so a brief that is
          missing, slow or failing leaves the two cards below untouched. */}
      <section style={s.cardSection}>
        <WhyRiskCard prId={prId} onOpenFile={onOpenFile} />
      </section>
      {/* Intent next: it frames what the description below is claiming to do. */}
      <section style={s.cardSection}>
        <IntentCard prId={prId} intent={intent} loading={intentLoading} />
      </section>
      {/* Blast next: intent says what the PR means to do, blast says what it can
          reach. Together they frame the description below. */}
      <section style={s.cardSection}>
        <BlastCard prId={prId} />
      </section>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
