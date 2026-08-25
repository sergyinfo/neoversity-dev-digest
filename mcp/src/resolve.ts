/**
 * Human identifiers → internal uuids.
 *
 * Every DevDigest REST route addresses rows by uuid. A model has no way to know
 * a uuid and no way to guess one, and Anthropic's tool guidance is explicit that
 * tool inputs should carry semantic identifiers rather than opaque ids. So the
 * MCP surface speaks `owner/name` + PR number + agent name, and the translation
 * to uuids happens here — one extra list call, paid once per tool call.
 *
 * Every failure path lists the valid alternatives, so a wrong guess costs the
 * agent one retry instead of a dead end.
 */
import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import { ApiError, apiGet } from './api.js';

export interface ResolvedPr {
  repo: Repo;
  pr: PrMeta & { id: string };
}

const lower = (s: string) => s.trim().toLowerCase();

/** Accepts `owner/name`, or a bare `name` when it is unambiguous. */
export async function resolveRepo(spec: string): Promise<Repo> {
  const repos = await apiGet<Repo[]>('/repos');
  if (repos.length === 0) {
    throw new ApiError(
      'No repositories are imported into DevDigest yet. Add one in the web app at ' +
        'http://localhost:3000 (Add repository) before using these tools.',
    );
  }

  const want = lower(spec);
  const exact = repos.find((r) => lower(r.full_name) === want);
  if (exact) return exact;

  const byName = repos.filter((r) => lower(r.name) === want);
  if (byName.length === 1) return byName[0]!;

  const known = repos.map((r) => r.full_name).join(', ');
  if (byName.length > 1) {
    throw new ApiError(`Repository "${spec}" is ambiguous. Use the full "owner/name": ${known}`);
  }
  throw new ApiError(`Repository "${spec}" is not imported into DevDigest. Known repositories: ${known}`);
}

/**
 * Resolve a PR by its GitHub number within a repo.
 *
 * `PrMeta.id` is nullish in the contract (the list endpoint can serve rows that
 * were never persisted), so the caller gets a narrowed type that guarantees one.
 */
export async function resolvePr(repoSpec: string, number: number): Promise<ResolvedPr> {
  const repo = await resolveRepo(repoSpec);
  const pulls = await apiGet<PrMeta[]>(`/repos/${repo.id}/pulls`);

  const pr = pulls.find((p) => p.number === number);
  if (!pr) {
    const known = pulls.length
      ? pulls
          .slice(0, 20)
          .map((p) => `#${p.number}`)
          .join(', ')
      : '(none imported)';
    throw new ApiError(
      `PR #${number} is not imported for ${repo.full_name}. Imported PRs: ${known}. ` +
        `Import more with the repo's Sync action in the web app.`,
    );
  }
  if (!pr.id) {
    throw new ApiError(
      `PR #${number} in ${repo.full_name} has no stored record yet. Open it once in the web app ` +
        'so DevDigest persists it, then retry.',
    );
  }

  return { repo, pr: { ...pr, id: pr.id } };
}

/** Match an agent by exact name, then by unique case-insensitive substring. */
export async function resolveAgent(name: string): Promise<Agent> {
  const agents = await apiGet<Agent[]>('/agents');
  const want = lower(name);

  const exact = agents.find((a) => lower(a.name) === want);
  if (exact) return exact;

  const partial = agents.filter((a) => lower(a.name).includes(want));
  if (partial.length === 1) return partial[0]!;

  const known = agents.map((a) => a.name).join(', ');
  if (partial.length > 1) {
    throw new ApiError(`Agent "${name}" matches several agents (${known}). Use the exact name.`);
  }
  throw new ApiError(`No agent named "${name}". Configured agents: ${known || '(none)'}`);
}
