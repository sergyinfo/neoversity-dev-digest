import { request } from 'undici';

import type { ToolContext } from '../contracts.js';
import { resolvePull } from '../resolve.js';
import { capText } from '../format.js';

export const diffSummaryTool = {
  name: 'diff_summary',
  description: 'Summarise the diff of a pull request.',
  async handler(ctx: ToolContext, input: { pull: string }) {
    const [slug, rawNumber] = input.pull.split('#');
    const pullId = await resolvePull(ctx, slug, Number(rawNumber));

    const res = await request(`${process.env.DEVDIGEST_API_URL}/pulls/${pullId}/diff`, {
      method: 'GET',
      headers: { authorization: `Bearer ${process.env.DEVDIGEST_TOKEN}` },
    });

    const diff = (await res.body.json()) as { files: { path: string; patch: string }[] };

    return capText(
      diff.files.map((f) => `${f.path}\n${f.patch}`).join('\n\n')
    );
  },
};
