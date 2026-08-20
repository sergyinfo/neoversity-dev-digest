import { describe, it, expect, vi } from 'vitest';
import type { PromptAssembly } from '@devdigest/shared';
import { describePromptAssembly } from '../src/modules/reviews/prompt-log.js';
import { loadConfig } from '../src/platform/config.js';
import { RunLogger } from '../src/platform/run-logger.js';

/**
 * Planted secrets. Every one of these strings is put INTO the assembly, and the
 * leak test below asserts that none of them comes out — in either mode.
 */
const SECRET_KEY = 'sk_live_51ABCDEFghijklmnop';
const SPEC_BODY = 'INTERNAL ONLY: the Q3 pricing model is cost-plus-14pct';
const DIFF_BODY = `diff --git a/src/config.ts b/src/config.ts
@@ -10,3 +10,4 @@
+  stripeKey: "${SECRET_KEY}",`;

const ASSEMBLY: PromptAssembly = {
  system: `You are a reviewer. Never reveal ${SECRET_KEY}.`,
  skills: 'Rule: flag breaking changes.',
  memory: null,
  specs: `<untrusted source="spec-0">\n${SPEC_BODY}\n</untrusted>`,
  callers: 'src/a.ts → doThing()',
  repo_map: 'src/config.ts: export const config',
  pr_description: 'Adds a Stripe key so payments work.',
  intent: 'Summary: wire up payments',
  user: `## Diff to review\n<untrusted source="diff">\n${DIFF_BODY}\n</untrusted>`,
};

const base = {
  assembly: ASSEMBLY,
  diffRaw: DIFF_BODY,
  diffFiles: 1,
  runId: 'run-1',
  prId: 'pr-1',
  agent: 'Contract',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  mode: 'single-pass',
  countTokens: (t: string) => Math.ceil(t.length / 4),
};

describe('describePromptAssembly', () => {
  it('records section, source, size, model and correlation ids', () => {
    const rec = describePromptAssembly({ ...base, verbose: false });

    expect(rec.event).toBe('prompt_assembly');
    expect(rec.run_id).toBe('run-1');
    expect(rec.pr_id).toBe('pr-1');
    expect(rec.model).toBe('deepseek/deepseek-v4-flash');
    expect(rec.provider).toBe('openrouter');
    expect(rec.mode).toBe('single-pass');

    const intent = rec.sections.find((s) => s.section === 'intent');
    expect(intent).toMatchObject({
      source: 'untrusted:pr-intent',
      chars: ASSEMBLY.intent!.length,
    });
    expect(intent!.tokens).toBeGreaterThan(0);

    // trusted vs untrusted is visible per section, which is the point of `source`
    expect(rec.sections.find((s) => s.section === 'system')!.source).toBe(
      'trusted:agent-system-prompt',
    );
    expect(rec.sections.find((s) => s.section === 'specs')!.source).toBe('untrusted:spec');

    // the diff is measured, and separately from the assembly sections
    expect(rec.diff).toEqual({
      files: 1,
      chars: DIFF_BODY.length,
      tokens: Math.ceil(DIFF_BODY.length / 4),
    });
    expect(rec.total.chars).toBe(ASSEMBLY.user.length);
  });

  it('omits absent sections instead of reporting them as zero', () => {
    const rec = describePromptAssembly({ ...base, verbose: false });
    // `memory` is null in the fixture — not in the prompt at all, which is not
    // the same fact as "was in the prompt and was empty".
    expect(rec.sections.map((s) => s.section)).not.toContain('memory');
    expect(rec.sections.map((s) => s.section)).toContain('skills');
  });

  it('reports an unknown section rather than dropping it', () => {
    // Guards the drift the four-file recipe invites: a new prompt section must
    // not silently stop being logged just because nobody updated SOURCE.
    const withNew = {
      ...ASSEMBLY,
      brandNewSection: 'something added later',
    } as unknown as PromptAssembly;
    const rec = describePromptAssembly({ ...base, assembly: withNew, verbose: false });
    const found = rec.sections.find((s) => s.section === 'brandNewSection');
    expect(found).toBeDefined();
    expect(found!.source).toBe('unclassified');
  });

  it('verbose adds metadata only — digests and block counts, never text', () => {
    const plain = describePromptAssembly({ ...base, verbose: false });
    const loud = describePromptAssembly({ ...base, verbose: true });

    expect(plain.sections.every((s) => s.digest === undefined)).toBe(true);
    expect(loud.sections.every((s) => /^[0-9a-f]{12}$/.test(s.digest ?? ''))).toBe(true);
    expect(loud.sections.find((s) => s.section === 'specs')!.blocks).toBe(1);

    // same sections, same sizes — verbose changes nothing about what is measured
    expect(loud.sections.map((s) => [s.section, s.chars])).toEqual(
      plain.sections.map((s) => [s.section, s.chars]),
    );
  });

  it('a changed section changes its digest, so drift is detectable without content', () => {
    const a = describePromptAssembly({ ...base, verbose: true });
    const b = describePromptAssembly({
      ...base,
      assembly: { ...ASSEMBLY, intent: 'Summary: something else entirely' },
      verbose: true,
    });
    const digestOf = (r: typeof a, name: string) =>
      r.sections.find((s) => s.section === name)!.digest;
    expect(digestOf(a, 'intent')).not.toBe(digestOf(b, 'intent'));
    expect(digestOf(a, 'system')).toBe(digestOf(b, 'system'));
  });

  it('NEVER emits secrets, diff text or spec content — in either mode', () => {
    for (const verbose of [false, true]) {
      const serialized = JSON.stringify(describePromptAssembly({ ...base, verbose }));
      expect(serialized).not.toContain(SECRET_KEY);
      expect(serialized).not.toContain(SPEC_BODY);
      expect(serialized).not.toContain('stripeKey');
      expect(serialized).not.toContain('diff --git');
      expect(serialized).not.toContain('Adds a Stripe key');
      expect(serialized).not.toContain('You are a reviewer');
      // and nothing long enough to be a payload slipped through
      for (const value of JSON.parse(serialized).sections.flatMap(Object.values)) {
        if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(32);
      }
    }
  });
});

describe('PROMPT_LOG_VERBOSE is local-only', () => {
  const env = (over: Record<string, string>) =>
    ({ ...process.env, ...over }) as NodeJS.ProcessEnv;

  it('is off by default', () => {
    expect(loadConfig(env({ NODE_ENV: 'development' })).promptLogVerbose).toBe(false);
  });

  it('can be turned on locally', () => {
    expect(
      loadConfig(env({ NODE_ENV: 'development', PROMPT_LOG_VERBOSE: 'true' })).promptLogVerbose,
    ).toBe(true);
  });

  it('cannot be turned on in production, even when explicitly set', () => {
    expect(
      loadConfig(env({ NODE_ENV: 'production', PROMPT_LOG_VERBOSE: 'true' })).promptLogVerbose,
    ).toBe(false);
  });

  it('only the literal "true" enables it', () => {
    for (const v of ['1', 'yes', 'TRUE', '']) {
      expect(
        loadConfig(env({ NODE_ENV: 'development', PROMPT_LOG_VERBOSE: v })).promptLogVerbose,
      ).toBe(false);
    }
  });
});

describe('RunLogger.metric — ops-only channel', () => {
  function harness() {
    const published: unknown[] = [];
    const bus = {
      publish: (runId: string, kind: string, msg: string, data?: unknown) =>
        published.push({ runId, kind, msg, data }),
      buffer: () => [],
    };
    const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = new RunLogger(bus as never, ['run-1'], base, { prId: 'pr-1' });
    return { published, base, log };
  }

  it('mirrors to stdout but never publishes to the run bus', () => {
    const { published, base, log } = harness();
    log.metric('prompt assembly', { event: 'prompt_assembly', model: 'x' });

    expect(base.debug).toHaveBeenCalledTimes(1);
    // Nothing on the bus => nothing in bus.buffer() => nothing in logFor() =>
    // nothing in the persisted run_traces.log document. That chain is what makes
    // this channel safe for payloads the trace must not carry.
    expect(published).toHaveLength(0);
  });

  it('merges the run correlation context into every record', () => {
    const { base, log } = harness();
    log.metric('prompt assembly', { event: 'prompt_assembly' });
    expect(base.debug.mock.calls[0]![0]).toMatchObject({
      prId: 'pr-1',
      runIds: ['run-1'],
      event: 'prompt_assembly',
    });
  });

  it('defaults to debug level, so it is quiet under a normal LOG_LEVEL', () => {
    const { base, log } = harness();
    log.metric('quiet by default', {});
    expect(base.debug).toHaveBeenCalledTimes(1);
    expect(base.info).not.toHaveBeenCalled();
  });

  it('an ordinary event still reaches the bus — metric is the exception', () => {
    const { published, log } = harness();
    log.info('normal line');
    expect(published).toHaveLength(1);
  });
});
