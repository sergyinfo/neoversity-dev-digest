import { z } from 'zod';

export const digestRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  since: z.coerce.date(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const digestEntrySchema = z.object({
  pullId: z.string().uuid(),
  title: z.string().max(300),
  summary: z.string().max(2000),
  riskScore: z.number().min(0).max(1),
});

export type DigestRequest = z.infer<typeof digestRequestSchema>;
export type DigestEntry = z.infer<typeof digestEntrySchema>;

export interface DigestReader {
  entriesSince(workspaceId: string, since: Date, limit: number): Promise<DigestEntry[]>;
}
