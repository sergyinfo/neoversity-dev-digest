import { createHash } from 'node:crypto';
import type { PromptAssembly } from '@devdigest/shared';

/**
 * Structured, content-free description of what went into a review prompt.
 *
 * WHY THIS EXISTS: "why did the model say that?" is usually answered by what the
 * prompt contained, but the prompt itself is the one thing we must not write to
 * disk — it carries the diff, the PR body, and whatever a private spec says. So
 * we record the SHAPE of the assembly (which sections, from which source, how
 * big, which model) and never the text.
 *
 * SAFETY CONTRACT — this module must never emit section content:
 *   - values are numbers, section keys, and fixed source labels;
 *   - the only content-derived value is a truncated SHA-256, which is a change
 *     detector, not a payload — it tells you a section DIFFERS between two runs
 *     without telling you what either said;
 *   - there is no verbosity level that turns content on. `verbose` buys finer
 *     METADATA (digests, block counts), never text. See `describePromptAssembly`.
 * `prompt-log.test.ts` asserts this mechanically against fixtures containing
 * planted secrets.
 *
 * WHY IT LIVES SERVER-SIDE: `reviewer-core` assembles the prompt but may not do
 * I/O (see reviewer-core/CLAUDE.md), so it cannot log. It already returns the
 * whole `PromptAssembly` in its outcome, which is everything this needs.
 */

/** How much a section is trusted, and which delimiter label wraps it (if any). */
const SOURCE: Record<string, string> = {
  system: 'trusted:agent-system-prompt',
  // "trusted-ish" per prompt.ts — community skill bodies are sanitized upstream.
  skills: 'trusted:linked-skills',
  memory: 'trusted:curated-memory',
  specs: 'untrusted:spec',
  repo_map: 'untrusted:repo-map',
  callers: 'untrusted:callers',
  pr_description: 'untrusted:pr-description',
  intent: 'untrusted:pr-intent',
};

/**
 * `user` is the joined result of every other section, so it is reported as the
 * assembly total rather than as a section of its own.
 */
const TOTAL_KEY = 'user';

export interface PromptSectionStat {
  /** The `PromptAssembly` key. Unknown keys are reported, not dropped — see below. */
  section: string;
  source: string;
  chars: number;
  tokens: number;
  /** Verbose only: first 12 hex of SHA-256. Change detector, never a payload. */
  digest?: string;
  /** Verbose only: how many `<untrusted …>` blocks the section wraps (specs → N chunks). */
  blocks?: number;
}

/**
 * A `type` rather than an `interface` on purpose: interfaces have no implicit
 * index signature, so an interface would not be assignable to the
 * `Record<string, unknown>` that `RunLogger.metric` takes, and the call site
 * would need a cast.
 */
export type PromptAssemblyRecord = {
  event: 'prompt_assembly';
  /** Correlation IDs. `run_id` joins this to agent_runs / run_traces / the SSE stream. */
  run_id: string;
  pr_id: string;
  agent: string;
  provider: string;
  model: string;
  /** 'single-pass' | 'map-reduce' — map-reduce assembles per chunk; this is the whole-diff one. */
  mode: string;
  verbose: boolean;
  sections: PromptSectionStat[];
  /** Diff is not a `PromptAssembly` field (it is inlined into `user`), so it is measured separately. */
  diff: { files: number; chars: number; tokens: number };
  total: { chars: number; tokens: number };
};

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function countBlocks(text: string): number {
  return text.split('<untrusted source="').length - 1;
}

/**
 * Describe an assembled prompt without reproducing any of it.
 *
 * Sections are read off the `PromptAssembly` OBJECT rather than a hand-written
 * list, deliberately: reviewer-core/INSIGHTS.md records that adding a prompt
 * section is already a four-file recipe, and a fifth hand-maintained list here
 * would go stale silently — a new section would simply stop being logged. Any
 * key not in `SOURCE` is still reported, labelled `unclassified`, which is a
 * visible prompt to come and classify it.
 *
 * `verbose` adds digests and block counts. It never adds content; there is no
 * level at which this function emits prompt text.
 */
export function describePromptAssembly(input: {
  assembly: PromptAssembly;
  /** Raw unified diff — measured, never emitted. */
  diffRaw: string;
  diffFiles: number;
  runId: string;
  prId: string;
  agent: string;
  provider: string;
  model: string;
  mode: string;
  countTokens: (text: string) => number;
  verbose: boolean;
}): PromptAssemblyRecord {
  const { assembly, countTokens, verbose } = input;

  const sections: PromptSectionStat[] = [];
  for (const [key, value] of Object.entries(assembly)) {
    if (key === TOTAL_KEY) continue;
    // Absent sections are omitted rather than reported as zero: `null` means the
    // section was not in the prompt at all, which is not the same as empty.
    if (typeof value !== 'string' || value.length === 0) continue;
    sections.push({
      section: key,
      source: SOURCE[key] ?? 'unclassified',
      chars: value.length,
      tokens: countTokens(value),
      ...(verbose ? { digest: digestOf(value), blocks: countBlocks(value) } : {}),
    });
  }

  const user = typeof assembly.user === 'string' ? assembly.user : '';

  return {
    event: 'prompt_assembly',
    run_id: input.runId,
    pr_id: input.prId,
    agent: input.agent,
    provider: input.provider,
    model: input.model,
    mode: input.mode,
    verbose,
    sections,
    diff: {
      files: input.diffFiles,
      chars: input.diffRaw.length,
      tokens: countTokens(input.diffRaw),
    },
    total: { chars: user.length, tokens: countTokens(user) },
  };
}
