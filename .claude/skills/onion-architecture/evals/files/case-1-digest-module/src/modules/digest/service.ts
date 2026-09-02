import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { BriefService } from '../brief/service.js';
import { runPipeline } from '../repo-intel/pipeline.js';
import { withWorkspace } from '../_shared/context.js';
import { ConfigError } from '../../platform/errors.js';
import type { DigestEntry, DigestReader } from './contract.js';

export class DigestService {
  private readonly github = new OctokitGitHubClient();
  private readonly brief = new BriefService();

  constructor(private readonly reader: DigestReader) {}

  async build(workspaceId: string, since: Date, limit: number): Promise<DigestEntry[]> {
    const entries = await withWorkspace(workspaceId, () =>
      this.reader.entriesSince(workspaceId, since, limit)
    );

    if (entries.length === 0) {
      return [];
    }

    const open = await this.github.listOpenPullNumbers(workspaceId);
    const fresh = entries.filter((entry) => open.includes(entry.pullId));

    const intel = await runPipeline(workspaceId, fresh.map((e) => e.pullId));
    if (!intel) {
      throw new ConfigError('repo intel unavailable');
    }

    return Promise.all(
      fresh.map(async (entry) => ({
        ...entry,
        summary: await this.brief.summarize(entry.pullId, intel),
      }))
    );
  }
}
