/* AgentEditor — agent config + linked skills. L02 adds the Skills tab; L05
   adds the read-only Context tab (BQ-2/b); L06 adds the Evals tab; Stats and
   CI come with later lessons.
   Tab state still lives in ?tab= for forward-compatibility. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { EvalsTab } from "./_components/EvalsTab";
import { TABS } from "./constants";
import { s } from "./styles";

/**
 * One entry per tab key. A two-way ternary (`tab === "skills" ? ... : ...`)
 * is what invited a third branch to be bolted on incorrectly — this map is
 * the fix, not the addition of the Context tab itself. An unrecognized key
 * (shouldn't happen; `TABS`/`page.tsx`'s `VALID_TABS` are kept in step)
 * falls back to Config rather than rendering nothing.
 */
const TAB_PANELS: Record<string, (agent: Agent) => React.ReactElement> = {
  config: (agent) => <ConfigTab agent={agent} />,
  skills: (agent) => <SkillsTab agent={agent} />,
  context: (agent) => <ContextTab agent={agent} />,
  evals: (agent) => <EvalsTab agent={agent} />,
};

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  const renderPanel = TAB_PANELS[tab] ?? TAB_PANELS.config!;
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>{renderPanel(agent)}</div>
    </div>
  );
}
