"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrIntentRecord } from "@/lib/types";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  prBody: string | null | undefined;
  intent: PrIntentRecord | null | undefined;
  intentLoading?: boolean;
}

export function OverviewTab({ prId, prBody, intent, intentLoading }: OverviewTabProps) {
  return (
    <>
      {/* Intent first: it frames what the description below is claiming to do. */}
      <section style={s.intentSection}>
        <IntentCard prId={prId} intent={intent} loading={intentLoading} />
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
