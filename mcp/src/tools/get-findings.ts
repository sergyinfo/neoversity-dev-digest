/** `get_findings` — the stored findings of reviews already run on a PR. */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ReviewRecord, Severity } from '@devdigest/shared';
import { apiGet } from '../api.js';
import { capped, guard, ok, oneLine, untrusted } from '../format.js';
import { resolvePr } from '../resolve.js';

const RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Hard ceiling on this tool's output, well under Claude Code's 25k-token cap. */
const MAX_CHARS = 24_000;

export function registerGetFindings(server: McpServer): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get review findings',
      description:
        'Read the findings produced by reviews already run on a pull request, most severe first. Does not run a review — call run_review for that.',
      inputSchema: z.object({
        repo: z.string().describe('Repository as "owner/name"'),
        pr: z.number().int().positive().describe('Pull request number on GitHub'),
        severity: z
          .enum(['CRITICAL', 'WARNING', 'SUGGESTION'])
          .optional()
          .describe('Keep only this severity'),
        agent: z.string().optional().describe('Keep only findings from this agent name'),
        limit: z.number().int().min(1).max(100).optional().describe('Max findings (default 20)'),
        format: z
          .enum(['concise', 'detailed'])
          .optional()
          .describe('concise = one line each (default); detailed adds explanation and suggested fix'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repo, pr, severity, agent, limit, format }) =>
      guard(async () => {
        const { repo: repoRow, pr: prRow } = await resolvePr(repo, pr);
        const reviews = await apiGet<ReviewRecord[]>(`/pulls/${prRow.id}/reviews`);

        if (reviews.length === 0) {
          return ok(
            `${repoRow.full_name} #${pr} has not been reviewed yet. ` +
              `Run run_review(repo="${repoRow.full_name}", pr=${pr}) first.`,
          );
        }

        const wantAgent = agent?.trim().toLowerCase();
        const all = reviews
          .filter((r) => !wantAgent || (r.agent_name ?? '').toLowerCase().includes(wantAgent))
          .flatMap((r) => r.findings.map((f) => ({ ...f, agent: r.agent_name ?? 'agent' })))
          .filter((f) => !severity || f.severity === severity)
          .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.confidence - a.confidence);

        if (all.length === 0) {
          const filters = [severity, agent].filter(Boolean).join(' + ');
          return ok(
            `No findings on ${repoRow.full_name} #${pr}${filters ? ` matching ${filters}` : ''}. ` +
              `${reviews.length} review(s) exist; ` +
              `verdicts: ${reviews.map((r) => `${r.agent_name ?? 'agent'}=${r.verdict ?? '—'}`).join(', ')}.`,
          );
        }

        const max = limit ?? 20;
        const shown = all.slice(0, max);
        const detailed = format === 'detailed';

        const lines = shown.map((f) => {
          const head = `- [${f.severity}/${f.category}] ${f.title} — ${f.file}:${f.start_line}${
            f.end_line !== f.start_line ? `-${f.end_line}` : ''
          } (${f.agent}, confidence ${f.confidence.toFixed(2)})`;
          if (!detailed) return head;
          const why = oneLine(f.explanation, 600);
          const fix = oneLine(f.suggestion, 400);
          return [head, why && `  why: ${why}`, fix && `  fix: ${fix}`].filter(Boolean).join('\n');
        });

        const header =
          `${all.length} finding(s) on ${repoRow.full_name} #${pr} — "${prRow.title}"` +
          (shown.length < all.length
            ? ` · showing ${shown.length}, narrow with severity/agent or raise limit`
            : '');

        // Titles, explanations and suggested fixes are third-party prose.
        return ok(
          capped(
            `${header}\n${untrusted('review-findings', lines.join('\n'))}`,
            MAX_CHARS,
            'use format="concise", a severity filter, or a smaller limit',
          ),
        );
      }),
  );
}
