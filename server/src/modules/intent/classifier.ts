import { z } from 'zod';
import type {
  Intent,
  IntentConfidence,
  IntentSource,
  LLMProvider,
  UnifiedDiff,
} from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import type { ResolvedReference } from './references.js';
import {
  INTENT_MAX_RETRIES,
  INTENT_SYSTEM_PROMPT,
  MAX_COMMIT_SUBJECTS,
  MAX_FILES_LISTED,
  MAX_ISSUE_BODY_CHARS,
  MAX_PR_BODY_CHARS,
} from './constants.js';

/**
 * The cheap-model intent pass.
 *
 * Pure by design: no DB, no GitHub, no fetching. Everything it needs arrives
 * resolved, and the LLM is injected — same shape as `conventions/extractor.ts`.
 *
 * Two deliberate choices worth knowing before editing:
 *
 * - **Header-only diff.** We send file paths and `@@` hunk headers, never the
 *   changed lines. Intent lives in structure and naming, not in statement
 *   bodies, and dropping the bodies is what makes this affordable on every PR.
 *   `savedTokens` in the result is the honest measurement of that trade.
 * - **Confidence is not taken on trust.** The model reports a band; the caller
 *   computes an evidence tier from what was actually in the prompt and takes the
 *   MINIMUM. Cheap models are systematically overconfident, so the model may
 *   only ever lower the band, never raise it above what the inputs justify.
 */

/**
 * What the MODEL returns — deliberately narrower than the `Intent` contract:
 * `sources` is computed from the inputs, so asking the model for it would invite
 * it to claim evidence it never saw.
 */
const ModelIntent = z.object({
  intent: z.string().min(1).describe('One sentence: what this PR is trying to achieve.'),
  in_scope: z
    .array(z.string())
    .describe('Topical areas or file groups this PR is about. Nouns naming areas, never directives.'),
  out_of_scope: z
    .array(z.string())
    .describe('Adjacent areas this PR deliberately does not touch. Nouns, never directives.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high = a referenced plan/spec or detailed ticket states the goal; medium = a thin description or ticket exists; low = inferred from title, branch, commits and file paths alone.',
    ),
});
type ModelIntent = z.infer<typeof ModelIntent>;

export interface ClassifyInput {
  title: string;
  body?: string | null;
  branch?: string | null;
  commitSubjects?: string[];
  issue?: { number: number; title: string; body?: string | null } | null;
  references?: ResolvedReference[];
  diff: UnifiedDiff;
  llm: LLMProvider;
  model: string;
  log?: { info: (msg: string, data?: unknown) => void };
}

export interface ClassifyResult {
  intent: Intent;
  /** The band the model itself reported, kept for calibration auditing. */
  modelBand: IntentConfidence;
  /** The band the available evidence justifies, computed here. */
  evidenceTier: IntentConfidence;
  fullDiffTokens: number;
  headerOnlyTokens: number;
  savedTokens: number;
  savedPct: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/** Deliberately a heuristic: ~4 chars/token. Labelled as an estimate wherever logged. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

const TIER_RANK: Record<IntentConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Which sources were actually present, strongest first. This is the
 * deterministic half of the confidence model — it describes the PROMPT, not the
 * model's opinion of it, which is exactly why it is trustworthy.
 */
export function sourcesOf(input: {
  body?: string | null;
  branch?: string | null;
  commitSubjects?: string[];
  issue?: { title: string } | null;
  references?: ResolvedReference[];
  diff: UnifiedDiff;
}): IntentSource[] {
  const out: IntentSource[] = [];
  // A spec counts only if it resolved to real content — a dangling link is not
  // evidence, and must not be allowed to inflate confidence to "high".
  if (input.references?.some((r) => r.content.trim().length > 0)) out.push('spec');
  if (input.issue) out.push('linked_issue');
  if (input.body && input.body.trim().length > 0) out.push('pr_description');
  if (input.commitSubjects && input.commitSubjects.length > 0) out.push('commits');
  if (input.branch && input.branch.trim().length > 0) out.push('branch');
  if (input.diff.files.length > 0) out.push('file_paths');
  return out;
}

/** The strongest band the present sources justify. */
export function evidenceTierOf(sources: IntentSource[]): IntentConfidence {
  if (sources.includes('spec')) return 'high';
  if (sources.includes('linked_issue') || sources.includes('pr_description')) return 'medium';
  return 'low';
}

/** The model may lower the band, never raise it above what the inputs support. */
export function capConfidence(
  modelBand: IntentConfidence,
  evidenceTier: IntentConfidence,
): IntentConfidence {
  return TIER_RANK[modelBand] < TIER_RANK[evidenceTier] ? modelBand : evidenceTier;
}

/** `@@ -a,b +c,d @@` per hunk — structure without any changed lines. */
function renderChangedFiles(diff: UnifiedDiff): string {
  const files = diff.files.slice(0, MAX_FILES_LISTED);
  const lines = files.map((f) => {
    const headers = f.hunks
      .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
      .join(' ');
    return `${f.path} (+${f.additions}/-${f.deletions})${headers ? `\n  ${headers}` : ''}`;
  });
  const omitted = diff.files.length - files.length;
  if (omitted > 0) lines.push(`…and ${omitted} more changed file(s)`);
  return lines.join('\n');
}

function buildUserMessage(input: ClassifyInput): string {
  const sections: string[] = [];

  // Always present — this block alone must be enough to produce an intent.
  sections.push(`## Pull request\nTitle: ${input.title}`);
  if (input.branch?.trim()) sections.push(`## Branch\n${input.branch}`);

  if (input.body?.trim()) {
    sections.push(
      `## PR description\n${wrapUntrusted('pr-description', input.body.slice(0, MAX_PR_BODY_CHARS))}`,
    );
  }
  if (input.issue) {
    const issueText = `${input.issue.title}\n\n${(input.issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS)}`;
    sections.push(
      `## Linked issue #${input.issue.number}\n${wrapUntrusted('linked-issue', issueText)}`,
    );
  }
  for (const ref of input.references ?? []) {
    sections.push(
      `## Referenced ${ref.kind === 'repo-file' ? 'plan/spec' : 'document'}: ${ref.source}\n` +
        wrapUntrusted(`spec:${ref.source}`, ref.content),
    );
  }
  if (input.commitSubjects && input.commitSubjects.length > 0) {
    const subjects = input.commitSubjects
      .slice(0, MAX_COMMIT_SUBJECTS)
      .map((s) => `- ${s.split('\n')[0]}`)
      .join('\n');
    sections.push(`## Commit subjects\n${wrapUntrusted('commits', subjects)}`);
  }
  sections.push(
    `## Changed files (paths + hunk headers only, no code)\n` +
      wrapUntrusted('changed-files', renderChangedFiles(input.diff)),
  );

  return sections.join('\n\n');
}

export async function classifyIntent(input: ClassifyInput): Promise<ClassifyResult> {
  const user = buildUserMessage(input);

  const sources = sourcesOf(input);
  const evidenceTier = evidenceTierOf(sources);

  const fullDiffTokens = estimateTokens(input.diff.raw);
  const headerOnlyTokens = estimateTokens(INTENT_SYSTEM_PROMPT) + estimateTokens(user);
  const savedTokens = fullDiffTokens - headerOnlyTokens;
  const savedPct = fullDiffTokens > 0 ? Math.round((savedTokens / fullDiffTokens) * 100) : 0;
  const refsBytes = (input.references ?? []).reduce(
    (n, r) => n + Buffer.byteLength(r.content),
    0,
  );

  input.log?.info(
    `Intent: requesting ${input.llm.id}/${input.model} — evidence ${evidenceTier} ` +
      `(${sources.join(', ') || 'none'}); ~${headerOnlyTokens} vs ~${fullDiffTokens} full-diff ` +
      `tokens (est. chars/4), saving ~${savedTokens} (${savedPct}%), refs ${refsBytes}B`,
  );

  const res = await input.llm.completeStructured<ModelIntent>({
    model: input.model,
    schema: ModelIntent,
    schemaName: 'PrIntent',
    // Classification, not prose: nothing here benefits from sampling variety.
    temperature: 0,
    maxRetries: INTENT_MAX_RETRIES,
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
  });

  const modelBand = res.data.confidence;
  const confidence = capConfidence(modelBand, evidenceTier);

  const intent: Intent = {
    intent: res.data.intent,
    in_scope: res.data.in_scope,
    out_of_scope: res.data.out_of_scope,
    confidence,
    sources,
  };

  input.log?.info(
    `Intent: ${intent.in_scope.length} in-scope / ${intent.out_of_scope.length} out-of-scope; ` +
      `model band ${modelBand}, evidence ${evidenceTier} → ${confidence} ` +
      `(${res.tokensIn}→${res.tokensOut} tokens, ${res.costUsd == null ? 'unpriced' : `$${res.costUsd}`})`,
  );

  return {
    intent,
    modelBand,
    evidenceTier,
    fullDiffTokens,
    headerOnlyTokens,
    savedTokens,
    savedPct,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}

// renderIntentBlock lives in ./block.ts — a leaf the reviews module can import
// without creating a cycle back through this file's dependencies.
export { renderIntentBlock } from './block.js';
