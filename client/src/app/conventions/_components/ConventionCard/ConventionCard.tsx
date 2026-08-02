/* One convention candidate: the rule, its evidence (clickable through to the
   real code on GitHub), confidence, and the accept / reject / edit controls. */
"use client";

import React from "react";
import { Button, Icon } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "../../../../lib/github-urls";
import { s, cardAccent, confidenceColor } from "../ConventionsView/styles";

export function ConventionCard({
  c,
  repoFullName,
  sha,
  pending,
  onAccept,
  onReject,
  onEditRule,
}: {
  c: ConventionCandidate;
  repoFullName?: string | null;
  /** Commit the evidence was read at — pins the deep link so line numbers hold. */
  sha?: string | null;
  pending?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEditRule: (rule: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(c.rule);

  const range =
    c.start_line != null
      ? `${c.evidence_path}:${c.start_line}${c.end_line && c.end_line !== c.start_line ? `-${c.end_line}` : ""}`
      : c.evidence_path;

  // Without a repo and a ref there is nothing to link to — render plain text
  // rather than a link that 404s.
  const href =
    repoFullName && sha
      ? githubBlobUrl(repoFullName, sha, c.evidence_path, c.start_line ?? undefined, c.end_line ?? undefined)
      : null;

  function commit() {
    const next = draft.trim();
    if (next && next !== c.rule) onEditRule(next);
    setEditing(false);
  }

  return (
    <div style={{ ...s.card, ...cardAccent(c.status) }}>
      <div style={s.cardBody}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(c.rule);
                setEditing(false);
              }
            }}
            style={s.ruleInput}
            aria-label="Convention rule"
          />
        ) : (
          <div style={s.rule} onDoubleClick={() => setEditing(true)}>
            {c.rule}
          </div>
        )}

        <div style={s.evidenceHead}>
          <Icon.FileText size={12} />
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" style={s.evidenceLink}>
              {range}
            </a>
          ) : (
            <span style={s.evidenceLink}>{range}</span>
          )}
          {href && <Icon.ExternalLink size={11} style={{ opacity: 0.6 }} />}
        </div>
        <pre style={s.snippet}>{c.evidence_snippet}</pre>

        <div style={s.meta}>
          {c.category && <span>{c.category}</span>}
          <span>Confidence</span>
          <span style={s.bar}>
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${Math.round(c.confidence * 100)}%`,
                background: confidenceColor(c.confidence),
              }}
            />
          </span>
          <span className="tnum">{Math.round(c.confidence * 100)}%</span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={c.status === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          full
          disabled={pending}
          onClick={onAccept}
        >
          {c.status === "accepted" ? "Accepted" : "Accept"}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          full
          disabled={pending}
          onClick={onReject}
        >
          {c.status === "rejected" ? "Rejected" : "Reject"}
        </Button>
        <Button kind="ghost" size="sm" icon="Edit" full onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    </div>
  );
}
