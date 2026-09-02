import type { ToolContext } from './contracts.js';

interface RepoRow {
  id: string;
  owner: string;
  name: string;
}

export async function resolveRepo(ctx: ToolContext, slug: string): Promise<string> {
  const [owner, name] = slug.split('/');
  const repos = await ctx.client.get<RepoRow[]>(`/repos?workspaceId=${ctx.workspaceId}`);
  const match = repos.find((r) => r.owner === owner && r.name === name);

  if (!match) {
    throw new Error(
      `Unknown repo "${slug}". Available: ${repos.map((r) => `${r.owner}/${r.name}`).join(', ')}`
    );
  }

  return match.id;
}

export async function resolvePull(
  ctx: ToolContext,
  slug: string,
  number: number
): Promise<string> {
  const repoId = await resolveRepo(ctx, slug);
  const pulls = await ctx.client.get<{ id: string; number: number }[]>(
    `/repos/${repoId}/pulls`
  );
  const match = pulls.find((p) => p.number === number);

  if (!match) {
    throw new Error(
      `Unknown pull #${number} in ${slug}. Available: ${pulls.map((p) => p.number).join(', ')}`
    );
  }

  return match.id;
}
