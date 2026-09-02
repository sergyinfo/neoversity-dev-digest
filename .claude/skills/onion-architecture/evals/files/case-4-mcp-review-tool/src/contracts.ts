import type { PullContract, FindingContract } from '@devdigest/shared';
import { reviewRequestSchema } from '@devdigest/shared';

import { ApiClient } from './client.js';

export type Pull = PullContract;
export type Finding = FindingContract;

export interface ReviewRequest {
  pullId: string;
  agent: string;
  force?: boolean;
}

export function parseReviewRequest(input: unknown): ReviewRequest {
  return reviewRequestSchema.parse(input);
}

export interface ToolContext {
  client: ApiClient;
  workspaceId: string;
}

export function toolContext(baseUrl: string, token: string, workspaceId: string): ToolContext {
  return { client: new ApiClient(baseUrl, token), workspaceId };
}
