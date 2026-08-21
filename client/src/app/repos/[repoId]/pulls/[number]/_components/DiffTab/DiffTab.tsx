"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /**
   * Open a flagged line's finding in the Findings tab. Supplied by the page,
   * which already holds both the review data needed to resolve (path, line) to
   * a finding id and the query-param helper that drives the tabs.
   */
  onOpenFinding?: (path: string, line: number) => void;
}

type Order = "smart" | "original";

export function DiffTab({ prId, filesCount, files, canComment, onOpenFinding }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const [order, setOrder] = React.useState<Order>("smart");

  const { data: smartDiff, isError: smartDiffFailed } = useSmartDiff(prId);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // Smart order is the default, but never at the cost of the diff itself: until
  // the grouping arrives — or if it fails outright — the original order renders,
  // so a reviewer is never left staring at a spinner where the files should be.
  const smartReady = order === "smart" && !!smartDiff && !smartDiffFailed;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            <Button
              kind={order === "smart" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setOrder("smart")}
            >
              Smart order
            </Button>
            <Button
              kind={order === "original" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setOrder("original")}
            >
              Original order
            </Button>
          </span>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {smartReady ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          commenting={commenting}
          onOpenFinding={onOpenFinding}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
