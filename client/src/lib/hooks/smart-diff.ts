"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/**
 * Reviewer-ordered view of a PR's changed files.
 *
 * Cheap to refetch on purpose: the endpoint makes no model call and only joins
 * rows that are already loaded, so the badge counts can be picked up right after
 * a review finishes by invalidating `["smart-diff", prId]` — no polling, and no
 * cost to getting it wrong.
 */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
