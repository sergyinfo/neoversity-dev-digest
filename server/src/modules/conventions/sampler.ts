/**
 * L02 — sample selection. Pure code, no model.
 *
 * Two sources, deliberately different in kind:
 *  - CONFIGS state the rules the project already agreed to (eslint, tsconfig,
 *    prettier). They are cheap, small, and the highest-signal input there is.
 *  - TOP-RANKED SOURCE FILES show what the code actually does, which is often
 *    not what the configs say.
 *
 * The model sees both and is asked to reconcile them.
 */

/** Config files worth reading verbatim, in priority order. */
export const CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'biome.json',
  '.editorconfig',
] as const;

/** Per-file cap. A single 5k-line file must not crowd out the other samples. */
export const MAX_FILE_CHARS = 6_000;
/** Whole-payload cap, so one repo cannot blow the model's context. */
export const MAX_TOTAL_CHARS = 60_000;

export interface Sample {
  path: string;
  content: string;
  kind: 'config' | 'source';
}

function clip(content: string, max = MAX_FILE_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n… [truncated]`;
}

/**
 * Collect samples within a character budget.
 *
 * Configs are added first and are never dropped for budget: they are small and
 * they carry the most signal per byte. Source files fill whatever remains.
 */
export async function collectSamples(
  configPaths: readonly string[],
  sourcePaths: readonly string[],
  readFile: (path: string) => Promise<string | undefined>,
): Promise<Sample[]> {
  const out: Sample[] = [];
  let budget = MAX_TOTAL_CHARS;

  for (const path of configPaths) {
    const content = await readFile(path);
    if (!content?.trim()) continue;
    const clipped = clip(content, 4_000);
    out.push({ path, content: clipped, kind: 'config' });
    budget -= clipped.length;
  }

  for (const path of sourcePaths) {
    if (budget <= 0) break;
    const content = await readFile(path);
    if (!content?.trim()) continue;
    const clipped = clip(content, Math.min(MAX_FILE_CHARS, budget));
    out.push({ path, content: clipped, kind: 'source' });
    budget -= clipped.length;
  }

  return out;
}

/** Render samples for the prompt, each fenced and labelled with its path. */
export function renderSamples(samples: Sample[]): string {
  return samples
    .map((s) => {
      // Line numbers are included because the model must cite a range, and
      // counting lines in a fenced block is exactly what models are worst at.
      const numbered = s.content
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(4)} | ${l}`)
        .join('\n');
      return `### ${s.path} (${s.kind})\n\`\`\`\n${numbered}\n\`\`\``;
    })
    .join('\n\n');
}
