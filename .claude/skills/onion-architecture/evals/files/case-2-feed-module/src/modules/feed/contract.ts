import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

export const feedQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  cursor: z.string().optional(),
  pageSize: z.number().int().min(1).max(50).default(25),
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;

export interface FeedItem {
  id: string;
  kind: 'review' | 'comment' | 'merge';
  actor: string;
  at: Date;
}

export function feedQueryFromRequest(request: FastifyRequest): FeedQuery {
  return feedQuerySchema.parse(request.query);
}

export interface FeedReader {
  page(query: FeedQuery): Promise<{ items: FeedItem[]; nextCursor: string | null }>;
}
