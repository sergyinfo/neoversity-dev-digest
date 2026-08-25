/** `list_agents` — the configured reviewers, as names the other tools accept. */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agent } from '@devdigest/shared';
import { apiGet } from '../api.js';
import { guard, ok, oneLine } from '../format.js';

export function registerListAgents(server: McpServer): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List review agents',
      description:
        'List the DevDigest review agents (reviewers) configured in this workspace, with their provider, model and enabled state. Use the returned name to pick an agent for run_review.',
      inputSchema: z.object({
        enabled_only: z.boolean().optional().describe('Only agents that are enabled (default: false)'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ enabled_only }) =>
      guard(async () => {
        const agents = await apiGet<Agent[]>('/agents');
        const shown = enabled_only ? agents.filter((a) => a.enabled) : agents;

        if (shown.length === 0) {
          return ok(
            enabled_only
              ? 'No enabled agents. Enable one in the web app (Agents), or call list_agents without enabled_only.'
              : 'No agents configured. Create one in the web app at http://localhost:3000/agents.',
          );
        }

        const lines = shown.map((a) => {
          const flags = [
            a.enabled ? 'enabled' : 'disabled',
            a.strategy,
            a.repo_intel ? 'repo-intel' : 'diff-only',
          ].join(' · ');
          const desc = oneLine(a.description, 120);
          return `- ${a.name} — ${a.provider}/${a.model} [${flags}]${desc ? `\n  ${desc}` : ''}`;
        });

        return ok(`${shown.length} agent(s):\n${lines.join('\n')}`);
      }),
  );
}
