"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

/**
 * Re-derive a PR's intent.
 *
 * There is deliberately NO `usePrIntent` read hook: intent rides along on
 * `PrDetail`, so the PR page already has it via `usePullDetail(prId)`. A second
 * read path could disagree with the first, which is worse than one extra field
 * on a payload the page fetches anyway. This mutation therefore invalidates the
 * `["pull", prId]` query rather than a query of its own.
 */
export function useRecomputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pull", prId] }),
  });
}
