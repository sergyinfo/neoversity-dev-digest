import type { Container } from '../../platform/container.js';

export interface ConventionSummary {
  repoId: string;
  rules: string[];
  source: 'indexed' | 'declared';
}

export interface EnrichedContext {
  repoId: string;
  diff: string;
  conventions?: ConventionSummary;
}

export class ConventionsService {
  constructor(private readonly container: Container) {}

  async enrich(workspaceId: string, repoId: string, diff: string): Promise<EnrichedContext> {
    const intel = await this.container.repoIntel.summarize(workspaceId, repoId);

    if (!intel) {
      throw new Error(`Repository ${repoId} is not indexed; index it before requesting a review`);
    }

    return {
      repoId,
      diff,
      conventions: { repoId, rules: intel.conventions, source: 'indexed' },
    };
  }
}
