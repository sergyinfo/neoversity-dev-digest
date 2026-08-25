/** `get_blast_radius` — what else a pull request can touch, from the code index. */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { BlastCaller, DownstreamImpact } from '@devdigest/shared';
import { apiGet } from '../api.js';
import { capped, fail, guard, ok } from '../format.js';
import { resolvePr } from '../resolve.js';

/**
 * The HTTP envelope, declared locally.
 *
 * It is module-local on the server too (`server/src/modules/blast/contract.ts`)
 * — see that file for why it is deliberately not a shared contract. The MAP
 * inside it (`ChangedSymbol` / `BlastCaller` / `DownstreamImpact`) really is
 * shared, so those are imported as types rather than restated.
 */
interface BlastResponse {
  pr_id: string;
  repo_full_name: string;
  head_sha: string;
  indexed_sha: string | null;
  state: 'ok' | 'partial' | 'degraded';
  reason: string | null;
  counts: { symbols: number; callers: number; endpoints: number; crons: number };
  map: { changed_symbols: { name: string; file: string; kind: string }[]; downstream: DownstreamImpact[] };
  prior_prs: { number: number; title: string }[];
}

/** Symbols rendered before the tail is summarised. The UI holds the full map. */
const MAX_SYMBOLS = 10;
const MAX_CALLERS = 6;
const MAX_CHARS = 12_000;

const callerLine = (c: BlastCaller) => `    ${c.file}:${c.line} (${c.name})`;

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius',
      description:
        'Impact analysis for a pull request: which symbols it changes, which call sites across the repository depend on them, and which HTTP endpoints those callers serve. Reads the prebuilt code index — no LLM call.',
      inputSchema: z.object({
        repo: z.string().describe('Repository as "owner/name"'),
        pr: z.number().int().positive().describe('Pull request number on GitHub'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repo, pr }) =>
      guard(async () => {
        const { repo: repoRow, pr: prRow } = await resolvePr(repo, pr);
        const blast = await apiGet<BlastResponse>(`/pulls/${prRow.id}/blast`);

        // The stub this replaces returned `isError: true` because an empty
        // SUCCESS reads to the model as "this change impacts nothing". The same
        // reasoning now applies to a missing index: `degraded` means the impact
        // is unknown, and saying so is the whole value of the answer.
        if (blast.state === 'degraded') {
          return fail(
            `The impact of ${repoRow.full_name} #${pr} is UNKNOWN — this repository has no usable ` +
              `code index${blast.reason ? ` (${blast.reason})` : ''}. Do NOT read this as "nothing is ` +
              'affected". Re-analyze the repository first (Repository → Re-analyze, or ' +
              'POST /repos/:id/resync), then ask again.',
          );
        }

        const impacted = blast.map.downstream.filter(
          (d) => d.callers.length > 0 || d.endpoints_affected.length > 0,
        );

        if (impacted.length === 0) {
          return ok(
            `${repoRow.full_name} #${pr} changes ${blast.counts.symbols} symbol(s), and the index ` +
              'shows no downstream callers or endpoints. The index is complete, so this is a real ' +
              '"nothing depends on this", not missing data.',
          );
        }

        const head =
          blast.state === 'partial'
            ? `NOTE: the code index is incomplete${blast.reason ? ` (${blast.reason})` : ''}, so callers may be missing from this map.\n\n`
            : '';

        // Rank by REACH first, then fan-out. Sorting on caller count alone put
        // test mocks at the top of the list — technically the busiest symbols,
        // and the least interesting thing a reviewer could be told. A symbol
        // that reaches an HTTP endpoint is the answer to "what else can this
        // touch"; one called only from tests usually is not.
        const shown = [...impacted]
          .sort(
            (a, b) =>
              b.endpoints_affected.length - a.endpoints_affected.length ||
              b.crons_affected.length - a.crons_affected.length ||
              b.callers.length - a.callers.length,
          )
          .slice(0, MAX_SYMBOLS);

        const body = shown
          .map((d) => {
            const lines = [`  ${d.symbol} — ${d.callers.length} caller(s)`];
            lines.push(...d.callers.slice(0, MAX_CALLERS).map(callerLine));
            if (d.callers.length > MAX_CALLERS) {
              lines.push(`    …and ${d.callers.length - MAX_CALLERS} more`);
            }
            for (const e of d.endpoints_affected) lines.push(`    reaches ${e}`);
            for (const c of d.crons_affected) lines.push(`    reaches cron ${c}`);
            return lines.join('\n');
          })
          .join('\n');

        const tail =
          impacted.length > shown.length
            ? `\n\n${impacted.length - shown.length} further symbol(s) not shown — open the PR in DevDigest for the full map.`
            : '';

        const { counts } = blast;
        return ok(
          capped(
            `${head}Blast radius of ${repoRow.full_name} #${pr} — "${prRow.title}"\n` +
              `${counts.symbols} changed symbol(s) · ${counts.callers} caller(s) · ` +
              `${counts.endpoints} endpoint(s)${counts.crons > 0 ? ` · ${counts.crons} cron(s)` : ''}\n` +
              `(callers are located in the indexed revision ${blast.indexed_sha?.slice(0, 8) ?? 'unknown'})\n\n${body}${tail}`,
            MAX_CHARS,
            'open the PR in DevDigest for the full map',
          ),
        );
      }),
  );
}
