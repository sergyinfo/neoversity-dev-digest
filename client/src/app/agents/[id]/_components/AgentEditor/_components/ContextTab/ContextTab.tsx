/* Context tab — read-only view of this agent's project-context projection
   (BQ-2/b). Attaching/detaching documents stays on `/context` (D-1); this
   tab reuses the same S8 projection endpoint with no server change. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { Agent } from "@devdigest/shared";
import { useAgentContextProjection } from "@/lib/hooks/project-context";
import { useAgentSkills, useSkills } from "@/lib/hooks/conventions";
import { ProjectionSummary } from "@/components/ProjectionSummary";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const router = useRouter();
  const projection = useAgentContextProjection(agent.id);
  const allSkills = useSkills();
  const agentSkills = useAgentSkills(agent.id);

  // Same composition `AgentsTab` (`/context`) uses: `resolveForAgent` filters
  // disabled skills out of the projection in SQL, so a disabled linked
  // skill's documents never reach `entries` — this is the only way to name
  // it as "not contributing" rather than have it silently vanish (AC-30).
  const disabledSkills = React.useMemo(() => {
    const byId = new Map((allSkills.data ?? []).map((sk) => [sk.id, sk]));
    return (agentSkills.data ?? [])
      .map((link) => byId.get(link.skill_id))
      .filter((sk): sk is NonNullable<typeof sk> => !!sk && !sk.enabled)
      .map((sk) => ({ id: sk.id, name: sk.name }));
  }, [allSkills.data, agentSkills.data]);

  return (
    <div style={s.wrap}>
      <p style={s.intro}>
        Documents this agent sends as project context on a run, direct and inherited via its
        enabled skills. Read-only —{" "}
        <button
          type="button"
          onClick={() => router.push("/context")}
          style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit" }}
        >
          attach or detach documents from Project Context
        </button>
        .
      </p>

      <div style={s.card}>
        <ProjectionSummary
          hasAgent
          projection={projection.data}
          isLoading={projection.isLoading}
          disabledSkills={disabledSkills}
        />
      </div>
    </div>
  );
}
