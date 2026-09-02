import { z } from 'zod';

export const insightSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  repoId: z.string().uuid(),
  finding: z.string().max(4000),
  confidence: z.enum(['low', 'medium', 'high']),
  supersededBy: z.string().uuid().nullable(),
});

export type Insight = z.infer<typeof insightSchema>;

export interface InsightStore {
  active(workspaceId: string, repoId: string): Promise<Insight[]>;
  supersede(id: string, byId: string): Promise<void>;
}
