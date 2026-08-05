/* Skills tab — link skills to this agent and order them. Linked skill bodies are
   appended to the agent's review prompt at run time, in this order. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useSkills } from "../../../../../../../lib/hooks/conventions";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/conventions";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const router = useRouter();
  const all = useSkills();
  const links = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills(agent.id);

  const byId = React.useMemo(
    () => new Map((all.data ?? []).map((sk) => [sk.id, sk])),
    [all.data],
  );

  // Server order is the array index, so the linked list is the source of truth
  // for ordering; everything else is "available".
  const linkedIds = React.useMemo(
    () => [...(links.data ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links.data],
  );
  const available = (all.data ?? []).filter((sk) => !linkedIds.includes(sk.id));

  const busy = setSkills.isPending;
  const commit = (ids: string[]) => setSkills.mutate(ids);

  function move(index: number, delta: number) {
    const next = [...linkedIds];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to]!, next[index]!];
    commit(next);
  }

  if (all.isLoading || links.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={180} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <p style={s.intro}>
        Linked skills are appended to this agent&rsquo;s prompt at run time, in the order below.
        A disabled skill is skipped.
      </p>

      <div style={s.sectionLabel}>Linked ({linkedIds.length})</div>
      {linkedIds.length === 0 ? (
        <EmptyState
          icon="Sparkles"
          title="No skills linked"
          body="This agent runs on its system prompt alone. Add a skill below."
        />
      ) : (
        <div style={s.list}>
          {linkedIds.map((id, i) => {
            const sk = byId.get(id);
            if (!sk) return null;
            return (
              <div key={id} style={s.row}>
                <div style={s.order}>{i + 1}</div>
                <div style={s.rowBody}>
                  <div style={s.rowName}>
                    {sk.name}
                    {!sk.enabled && <span style={s.disabled}>disabled</span>}
                  </div>
                  <div style={s.rowMeta}>
                    {sk.type} · {sk.source} · v{sk.version}
                  </div>
                </div>
                <div style={s.rowActions}>
                  <button
                    style={s.iconBtn}
                    disabled={i === 0 || busy}
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${sk.name} up`}
                  >
                    <Icon.ArrowUp size={14} />
                  </button>
                  <button
                    style={s.iconBtn}
                    disabled={i === linkedIds.length - 1 || busy}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${sk.name} down`}
                  >
                    <Icon.ArrowDown size={14} />
                  </button>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="X"
                    disabled={busy}
                    onClick={() => commit(linkedIds.filter((x) => x !== id))}
                  >
                    Unlink
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={s.sectionLabel}>Available ({available.length})</div>
      {available.length === 0 ? (
        <p style={s.hint}>
          Every skill is linked.{" "}
          <button style={s.link} onClick={() => router.push("/skills")}>
            Create or import another
          </button>
          .
        </p>
      ) : (
        <div style={s.list}>
          {available.map((sk) => (
            <div key={sk.id} style={s.row}>
              <div style={s.rowBody}>
                <div style={s.rowName}>
                  {sk.name}
                  {!sk.enabled && <span style={s.disabled}>disabled</span>}
                </div>
                <div style={s.rowMeta}>
                  {sk.type} · {sk.source} · v{sk.version}
                </div>
              </div>
              <div style={s.rowActions}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Plus"
                  disabled={busy}
                  onClick={() => commit([...linkedIds, sk.id])}
                >
                  Link
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {setSkills.isError && (
        <div style={s.error}>
          {setSkills.error instanceof Error ? setSkills.error.message : "Could not update links"}
        </div>
      )}
    </div>
  );
}
