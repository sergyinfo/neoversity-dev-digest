import { describe, it, expect } from 'vitest';
import { verifyCandidate, verifyAll, type RawCandidate } from '../src/modules/conventions/verify.js';
import { collectSamples, renderSamples } from '../src/modules/conventions/sampler.js';
import { renderSkillBody, conventionsSkillName } from '../src/modules/conventions/skill-body.js';

/**
 * L02 — the parts of the extractor that run WITHOUT a model. These are the
 * pieces that decide whether a candidate is trustworthy, so they carry the most
 * risk per line.
 */

const FILE = `import { Redis } from 'ioredis';
import { config } from './config';

export const redis = new Redis(config.redisUrl);

export function get(key: string) {
  return redis.get(key);
}`;

const files: Record<string, string> = { 'src/lib/redis.ts': FILE };
const readFile = async (p: string) => files[p];

function candidate(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    rule: 'Redis access goes through the src/lib/redis.ts singleton',
    evidence_path: 'src/lib/redis.ts',
    evidence_snippet: 'export const redis = new Redis(config.redisUrl);',
    start_line: 4,
    end_line: 4,
    confidence: 0.85,
    ...over,
  };
}

describe('evidence gate', () => {
  it('accepts a snippet that really is at the cited lines', async () => {
    const r = await verifyCandidate(candidate(), readFile);
    expect(r.ok).toBe(true);
  });

  it('rejects a file that does not exist', async () => {
    const r = await verifyCandidate(candidate({ evidence_path: 'src/nope.ts' }), readFile);
    expect(r).toEqual({ ok: false, reason: 'file-missing' });
  });

  it('rejects a range past the end of the file', async () => {
    const r = await verifyCandidate(candidate({ start_line: 900, end_line: 901 }), readFile);
    expect(r).toEqual({ ok: false, reason: 'range-out-of-bounds' });
  });

  it('rejects an inverted or zero range', async () => {
    expect(await verifyCandidate(candidate({ start_line: 5, end_line: 2 }), readFile)).toEqual({
      ok: false,
      reason: 'bad-range',
    });
    expect(await verifyCandidate(candidate({ start_line: 0 }), readFile)).toEqual({
      ok: false,
      reason: 'bad-range',
    });
  });

  // The check that actually matters: a plausible path and an in-bounds range are
  // easy to guess, so only the snippet proves the model read the file.
  it('rejects invented code that never appears in the file', async () => {
    const r = await verifyCandidate(
      candidate({ evidence_snippet: 'export const redis = createClient(process.env.REDIS_URL);' }),
      readFile,
    );
    expect(r).toEqual({ ok: false, reason: 'snippet-mismatch' });
  });

  it('rejects a real snippet cited at the wrong place in the file', async () => {
    const r = await verifyCandidate(
      candidate({ evidence_snippet: "import { Redis } from 'ioredis';", start_line: 7, end_line: 7 }),
      readFile,
    );
    expect(r).toEqual({ ok: false, reason: 'snippet-mismatch' });
  });

  it('forgives indentation and an off-by-one range', async () => {
    const r = await verifyCandidate(
      candidate({
        evidence_snippet: '   export const redis = new Redis(config.redisUrl);   ',
        start_line: 5,
        end_line: 5,
      }),
      readFile,
    );
    expect(r.ok).toBe(true);
  });

  it('splits a batch into verified and rejected', async () => {
    const out = await verifyAll([candidate(), candidate({ evidence_path: 'gone.ts' })], readFile);
    expect(out.verified).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]!.reason).toBe('file-missing');
  });
});

describe('sampler', () => {
  it('keeps configs even when source files fill the budget, and numbers lines', async () => {
    const big = 'x'.repeat(200_000);
    const samples = await collectSamples(
      ['tsconfig.json'],
      ['a.ts', 'b.ts'],
      async (p) => (p === 'tsconfig.json' ? '{"strict":true}' : big),
    );
    expect(samples[0]!.kind).toBe('config');
    expect(samples.some((s) => s.kind === 'source')).toBe(true);

    const rendered = renderSamples(samples);
    expect(rendered).toContain('### tsconfig.json (config)');
    // Line numbers are what the model cites, so they must be in the payload.
    expect(rendered).toContain('   1 | ');
  });

  it('skips files that are missing or blank', async () => {
    const samples = await collectSamples(['a', 'b'], [], async (p) => (p === 'a' ? '   ' : undefined));
    expect(samples).toHaveLength(0);
  });
});

describe('skill body', () => {
  const accepted = [
    {
      rule: 'Always use async/await instead of .then() chains',
      category: 'async',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'const user = await db.users.find(id);',
      start_line: 23,
      end_line: 31,
    },
  ];

  it('renders a directive body citing file:line', () => {
    const body = renderSkillBody('payments-api', accepted);
    expect(body).toContain('# payments-api-conventions');
    expect(body).toContain('Flag changes that violate any rule below');
    expect(body).toContain('src/api/users.ts:23-31');
    expect(body).toContain('const user = await db.users.find(id);');
  });

  // A snippet containing a fence would otherwise close the block early and let
  // repository content pose as instructions.
  it('widens the fence when the snippet contains backticks', () => {
    const body = renderSkillBody('r', [
      { ...accepted[0]!, evidence_snippet: '```js\nlet x = 1;\n```' },
    ]);
    expect(body).toContain('````');
  });

  it('derives a stable skill name', () => {
    expect(conventionsSkillName('payments-api')).toBe('payments-api-conventions');
  });
});
