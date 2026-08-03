/* hooks/conventions.ts — React Query hooks for the L02 Conventions extractor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionStatus,
  Skill,
  SkillType,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Runs the extractor — one model call, so never on mount. */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useSetConventionStatus(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ConventionStatus }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useEditConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: string }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { rule }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface SkillDraft {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  evidence_files: string[];
  from_count: number;
}

/**
 * The draft is rendered server-side from the ACCEPTED rows, then edited in the
 * modal before `POST /skills` saves it — the server never trusts a client list.
 * `enabled: false` because it is fetched when the modal opens, not on page load.
 */
export function useSkillDraft(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId, "skill-draft"],
    queryFn: () => api.get<SkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: false,
    gcTime: 0,
  });
}

export function useSkills() {
  return useQuery({ queryKey: ["skills"], queryFn: () => api.get<Skill[]>("/skills") });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  /** `extracted` when built from conventions; the server rejects other claims. */
  source?: "manual" | "extracted";
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<CreateSkillInput>) =>
      api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill", s.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/skills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name?: string; type?: SkillType }) =>
      api.post<Skill>("/skills/import", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- agent ↔ skill links ---------------------------------------------------

/** Link rows for an agent, ordered. The endpoint returns links, not full skills. */
export interface AgentSkillLinkRow {
  agent_id: string;
  skill_id: string;
  order: number;
}

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLinkRow[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replaces the whole ordered set. Sending the full list (rather than one add /
 * one remove) keeps ordering unambiguous — order is the array index server-side.
 */
export function useSetAgentSkills(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLinkRow[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });
}
