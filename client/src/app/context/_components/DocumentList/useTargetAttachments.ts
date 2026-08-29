"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AttachmentRow, AttachmentTargetKind } from "@/lib/hooks/project-context";

/**
 * Attachment rows (with their `id`) for one target — an agent or a skill.
 *
 * `hooks/project-context.ts` (S11) covers document listing, the per-agent
 * projection, and attach/detach/reorder mutations, but nothing there LISTS
 * the current attachments for a target. Detaching needs the row `id`
 * (`DELETE /context/attachments/:id`), which cannot be derived from a path,
 * so the Agents/Skills tabs need this query to know which documents are
 * currently attached and by which row. Colocated here — under this track's
 * file set — rather than added to `hooks/project-context.ts`, which sits
 * outside it (S11 belongs to a different track).
 */
export function useTargetAttachments(
  targetKind: AttachmentTargetKind,
  targetId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-attachments", targetKind, targetId],
    queryFn: () =>
      api.get<AttachmentRow[]>(
        `/context/attachments?target_kind=${targetKind}&target_id=${targetId}`,
      ),
    enabled: !!targetId,
  });
}
