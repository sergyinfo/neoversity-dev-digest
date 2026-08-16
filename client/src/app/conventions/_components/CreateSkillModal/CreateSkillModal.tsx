/* Create skill from accepted conventions. The body is rendered server-side from
   the ACCEPTED rows and is editable here before saving — the server re-reads the
   accepted set, so nothing a rejected candidate contributed can slip in. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, Toggle } from "@devdigest/ui";
import { useCreateSkill, useSkillDraft } from "../../../../lib/hooks/conventions";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  onClose,
}: {
  repoId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const draft = useSkillDraft(repoId);
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Fetched on open (the query is disabled by default) so the draft always
  // reflects the accept/reject decisions made a moment ago.
  React.useEffect(() => {
    draft.refetch().then((r) => {
      if (!r.data) return;
      setName(r.data.name);
      setDescription(r.data.description);
      setBody(r.data.body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setError(null);
    try {
      const skill = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        type: "convention",
        source: "extracted",
        body,
        enabled,
        evidence_files: draft.data?.evidence_files ?? [],
      });
      onClose();
      router.push(`/skills/${skill.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the skill");
    }
  }

  const ready = name.trim().length > 0 && body.trim().length > 0;

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create skill from conventions">
        <div style={s.head}>
          <div>
            <h2 style={s.title}>Create skill from conventions</h2>
            <div style={s.sub}>{name || "…"}</div>
          </div>
          <button style={s.close} onClick={onClose} aria-label="Close">
            <Icon.X size={18} />
          </button>
        </div>

        {draft.isLoading && <div style={s.note}>Rendering draft…</div>}
        {draft.isError && (
          <div style={{ ...s.note, color: "var(--crit)" }}>
            Could not render a draft. Accept at least one convention first.
          </div>
        )}

        {draft.data && (
          <div style={s.note}>
            <Icon.Sparkles size={14} />
            Merged from <b>{draft.data.from_count} accepted convention(s)</b>. Everything below is
            editable before you save.
          </div>
        )}

        <div style={s.body}>
          <label style={s.label}>
            Name <span style={s.req}>*</span>
          </label>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} />

          <label style={s.label}>Description</label>
          <input
            style={s.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div style={s.row}>
            <div>
              <label style={s.label}>Type</label>
              <div style={s.static}>convention</div>
            </div>
            <div>
              <label style={s.label}>Enabled</label>
              <div style={s.toggleRow}>
                <Toggle on={enabled} onChange={setEnabled} size={18} />
                <span style={s.hint}>Whether this block is added to agents&rsquo; prompts.</span>
              </div>
            </div>
          </div>

          <label style={s.label}>
            Skill body <span style={s.req}>*</span>
          </label>
          <textarea
            style={s.textarea}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
          />
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.foot}>
          <span style={s.hint}>Saved as v1 · added to Skills</span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <Button kind="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              disabled={!ready}
              loading={create.isPending}
              onClick={save}
            >
              Create skill
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
