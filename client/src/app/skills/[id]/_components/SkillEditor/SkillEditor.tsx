/* /skills/:id — Config + Preview. Two tabs only: the L02 scope decision. Evals,
   Stats and Versions in the design drop belong to later lessons. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Skeleton, Toggle, Markdown } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { useSkill, useUpdateSkill, useDeleteSkill } from "../../../../../lib/hooks/conventions";
import { s } from "./styles";

type Tab = "config" | "preview";

export function SkillEditor({ id }: { id: string }) {
  const router = useRouter();
  const { data: skill, isLoading, isError, refetch } = useSkill(id);
  const update = useUpdateSkill();
  const remove = useDeleteSkill();

  const [tab, setTab] = React.useState<Tab>("config");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);

  // Load once the skill arrives. Re-syncing on every render would fight the user
  // as they type.
  React.useEffect(() => {
    if (!skill) return;
    setName(skill.name);
    setDescription(skill.description);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    !!skill &&
    (name !== skill.name ||
      description !== skill.description ||
      body !== skill.body ||
      enabled !== skill.enabled);

  // Only a body change bumps the version, matching the server's rule.
  const bodyChanged = !!skill && body !== skill.body;

  if (isLoading) {
    return (
      <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }]}>
        <div style={s.page}>
          <Skeleton height={320} />
        </div>
      </AppShell>
    );
  }
  if (isError || !skill) {
    return (
      <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }]}>
        <div style={s.page}>
          <ErrorState title="Could not load this skill" onRetry={() => refetch()} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }, { label: skill.name }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{skill.name}</h1>
            <p style={s.subtitle}>
              {skill.type} · {skill.source} · v{skill.version}
            </p>
          </div>
          <Button
            kind="danger"
            size="sm"
            icon="Trash"
            loading={remove.isPending}
            onClick={async () => {
              await remove.mutateAsync(skill.id);
              router.push("/skills");
            }}
          >
            Delete
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Check"
            disabled={!dirty}
            loading={update.isPending}
            onClick={() =>
              update.mutate({ id: skill.id, name, description, body, enabled })
            }
          >
            Save{bodyChanged ? ` (v${skill.version + 1})` : ""}
          </Button>
        </div>

        <div style={s.tabs}>
          {(["config", "preview"] as Tab[]).map((k) => (
            <button
              key={k}
              style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }}
              onClick={() => setTab(k)}
            >
              {k === "config" ? "Config" : "Preview"}
            </button>
          ))}
        </div>

        {tab === "config" ? (
          <>
            <label style={s.label}>Name</label>
            <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} />

            <label style={s.label}>Description</label>
            <input
              style={s.input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <label style={s.label}>Enabled</label>
            <div style={s.toggleRow}>
              <Toggle on={enabled} onChange={setEnabled} size={18} />
              <span style={s.hint}>
                A disabled skill is skipped when assembling an agent&rsquo;s prompt.
              </span>
            </div>

            <label style={s.label}>Skill body</label>
            <textarea
              style={s.textarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
            />

            {skill.evidence_files && skill.evidence_files.length > 0 && (
              <>
                <label style={s.label}>Evidence files</label>
                <ul style={s.evidence}>
                  {skill.evidence_files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          // What an agent actually receives, rendered the way a human reads it.
          <div style={s.preview}>
            <Markdown>{body}</Markdown>
          </div>
        )}
      </div>
    </AppShell>
  );
}
