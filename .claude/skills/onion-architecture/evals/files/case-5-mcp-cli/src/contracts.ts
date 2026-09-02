import type { FindingContract, ReviewContract } from '@devdigest/shared';

export type Finding = FindingContract;
export type Review = ReviewContract;

export interface CommandContext {
  apiUrl: string;
  token: string;
  workspaceId: string;
}

export interface ReviewOutcome {
  verdict: 'approve' | 'comment' | 'request_changes';
  score: number;
  findings: Finding[];
}
