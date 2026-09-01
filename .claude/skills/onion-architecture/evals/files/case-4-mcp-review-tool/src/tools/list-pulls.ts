import type { Pull, ToolContext } from '../contracts.js';
import { resolveRepo } from '../resolve.js';
import { capList } from '../format.js';

export const listPullsTool = {
  name: 'list_pulls',
  description: 'List open pull requests for a repository.',
  async handler(ctx: ToolContext, input: { repo: string; state?: 'open' | 'all' }) {
    const repoId = await resolveRepo(ctx, input.repo);
    const pulls = await ctx.client.get<Pull[]>(
      `/repos/${repoId}/pulls?state=${input.state ?? 'open'}`
    );

    console.log(`[list_pulls] ${pulls.length} pulls for ${input.repo}`);

    return capList(
      pulls.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.author,
        changedFiles: p.changedFiles,
      }))
    );
  },
};
