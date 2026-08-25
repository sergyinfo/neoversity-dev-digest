/** `get_conventions` — the house rules DevDigest extracted from a repository. */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ConventionCandidate } from '@devdigest/shared';
import { apiGet } from '../api.js';
import { capped, guard, ok, oneLine, untrusted } from '../format.js';
import { resolveRepo } from '../resolve.js';

const MAX_CHARS = 16_000;

export function registerGetConventions(server: McpServer): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get repository conventions',
      description:
        "Read the house conventions DevDigest extracted from a repository's own code, each with the file it was proven against. Useful before writing code in that repo. Defaults to the accepted rules only.",
      inputSchema: z.object({
        repo: z.string().describe('Repository as "owner/name"'),
        status: z
          .enum(['accepted', 'pending', 'rejected', 'all'])
          .optional()
          .describe('Which candidates to return (default: accepted)'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repo, status }) =>
      guard(async () => {
        const repoRow = await resolveRepo(repo);
        const all = await apiGet<ConventionCandidate[]>(`/repos/${repoRow.id}/conventions`);

        const want = status ?? 'accepted';
        const shown = want === 'all' ? all : all.filter((c) => c.status === want);

        if (shown.length === 0) {
          if (all.length === 0) {
            return ok(
              `No conventions have been extracted for ${repoRow.full_name} yet. ` +
                'Run the Conventions extractor in the web app (repository → Conventions → Extract), ' +
                'then call this tool again.',
            );
          }
          const tally = (['accepted', 'pending', 'rejected'] as const)
            .map((s) => `${s}=${all.filter((c) => c.status === s).length}`)
            .join(', ');
          return ok(
            `No "${want}" conventions for ${repoRow.full_name}. Available: ${tally}. ` +
              'Pass status="all" to see every candidate.',
          );
        }

        const lines = shown
          .sort((a, b) => b.confidence - a.confidence)
          .map((c) => {
            const where = c.start_line ? `${c.evidence_path}:${c.start_line}` : c.evidence_path;
            const cat = c.category ? `[${c.category}] ` : '';
            const flag = want === 'all' ? ` (${c.status})` : '';
            return `- ${cat}${oneLine(c.rule, 220)}${flag}\n  evidence: ${where} · confidence ${c.confidence.toFixed(2)}`;
          });

        // The rules were written by a model reading someone else's repository.
        return ok(
          capped(
            `${shown.length} ${want === 'all' ? '' : `${want} `}convention(s) for ${repoRow.full_name}:\n` +
              untrusted('repo-conventions', lines.join('\n')),
            MAX_CHARS,
            'filter by status',
          ),
        );
      }),
  );
}
