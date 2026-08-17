import { describe, it, expect } from 'vitest';
import type { IntentConfidence, UnifiedDiff } from '@devdigest/shared';
import {
  capConfidence,
  classifyIntent,
  estimateTokens,
  evidenceTierOf,
  renderIntentBlock,
  sourcesOf,
} from '../src/modules/intent/classifier.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const DIFF: UnifiedDiff = {
  raw: 'x'.repeat(40_000),
  files: [
    {
      path: 'src/middleware/ratelimit.ts',
      additions: 42,
      deletions: 0,
      hunks: [
        { file: 'src/middleware/ratelimit.ts', oldStart: 0, oldLines: 0, newStart: 1, newLines: 42, newLineNumbers: [] },
      ],
    },
    {
      path: 'src/api/public/index.ts',
      additions: 3,
      deletions: 1,
      hunks: [
        { file: 'src/api/public/index.ts', oldStart: 10, oldLines: 4, newStart: 10, newLines: 6, newLineNumbers: [] },
      ],
    },
  ],
};

const MODEL_FIXTURE = {
  intent: 'Add rate limiting to the public API endpoints.',
  in_scope: ['rate-limiting middleware', 'public API routes'],
  out_of_scope: ['authentication'],
  confidence: 'high' as const,
};

const llm = (fixture: unknown = MODEL_FIXTURE) =>
  new MockLLMProvider('openrouter', { structuredBySchema: { PrIntent: fixture } });

// ---------------------------------------------------------------- pure halves

describe('evidence tier (the deterministic half of confidence)', () => {
  it('maps the strongest present source to a band', () => {
    expect(evidenceTierOf(['spec', 'pr_description', 'file_paths'])).toBe('high');
    expect(evidenceTierOf(['linked_issue', 'file_paths'])).toBe('medium');
    expect(evidenceTierOf(['pr_description', 'branch'])).toBe('medium');
    expect(evidenceTierOf(['commits', 'branch', 'file_paths'])).toBe('low');
    expect(evidenceTierOf([])).toBe('low');
  });

  it('detects sources from the inputs, not from the model', () => {
    expect(
      sourcesOf({
        body: 'Adds a token bucket.',
        branch: 'feat/rate-limit',
        commitSubjects: ['feat: add limiter'],
        issue: { title: 'Rate limit the API' },
        references: [{ kind: 'repo-file', source: 'docs/plans/rl.md', content: '# Plan' }],
        diff: DIFF,
      }),
    ).toEqual(['spec', 'linked_issue', 'pr_description', 'commits', 'branch', 'file_paths']);
  });

  it('does not count a reference that resolved to nothing as a spec', () => {
    const sources = sourcesOf({
      references: [{ kind: 'url', source: 'https://x/y', content: '   ' }],
      diff: DIFF,
    });
    expect(sources).not.toContain('spec');
    expect(evidenceTierOf(sources)).toBe('low');
  });

  it('a sparse PR still reports the always-present signals', () => {
    const sources = sourcesOf({
      body: null,
      branch: 'fix/off-by-one',
      commitSubjects: ['fix: off by one'],
      issue: null,
      diff: DIFF,
    });
    expect(sources).toEqual(['commits', 'branch', 'file_paths']);
    expect(evidenceTierOf(sources)).toBe('low');
  });
});

describe('capConfidence — the model may lower, never raise', () => {
  const cases: [IntentConfidence, IntentConfidence, IntentConfidence][] = [
    ['high', 'low', 'low'],
    ['high', 'medium', 'medium'],
    ['high', 'high', 'high'],
    ['medium', 'high', 'medium'],
    ['low', 'high', 'low'],
    ['low', 'medium', 'low'],
  ];
  it.each(cases)('model=%s evidence=%s → %s', (band, tier, expected) => {
    expect(capConfidence(band, tier)).toBe(expected);
  });
});

describe('estimateTokens', () => {
  it('is a chars/4 heuristic', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

// ---------------------------------------------------- prompt shaping (the real logic)

describe('classifyIntent — message shaping', () => {
  it('sends hunk headers but NEVER the changed lines', async () => {
    const mock = llm();
    await classifyIntent({ title: 'Add rate limiting', diff: DIFF, llm: mock, model: 'cheap' });
    const sent = JSON.stringify(mock.calls);
    expect(sent).toContain('src/middleware/ratelimit.ts');
    expect(sent).toContain('@@ -0,0 +1,42 @@');
    // The raw diff body must not leak in — that is the whole cost saving.
    expect(sent).not.toContain('x'.repeat(200));
  });

  it('on a PR with no description, issue or plan, still sends branch + commits + paths', async () => {
    const mock = llm({ ...MODEL_FIXTURE, confidence: 'low' });
    const res = await classifyIntent({
      title: 'fix off-by-one in limiter window',
      body: null,
      branch: 'fix/limiter-window',
      commitSubjects: ['fix: off by one in the window boundary'],
      issue: null,
      diff: DIFF,
      llm: mock,
      model: 'cheap',
    });
    const user = JSON.stringify(mock.calls);
    expect(user).toContain('fix/limiter-window');
    expect(user).toContain('off by one in the window boundary');
    expect(user).toContain('src/api/public/index.ts');
    expect(user).not.toContain('## PR description');
    expect(user).not.toContain('## Linked issue');
    // Never empty, and honestly labelled as weakly evidenced.
    expect(res.intent.intent.length).toBeGreaterThan(0);
    expect(res.intent.confidence).toBe('low');
    expect(res.intent.sources).toEqual(['commits', 'branch', 'file_paths']);
  });

  it('wraps every author-controlled section as untrusted', async () => {
    const mock = llm();
    await classifyIntent({
      title: 'T',
      body: 'BODY_TEXT',
      commitSubjects: ['COMMIT_TEXT'],
      issue: { number: 7, title: 'ISSUE_TITLE', body: 'ISSUE_BODY' },
      references: [{ kind: 'repo-file', source: 'docs/plans/p.md', content: 'PLAN_TEXT' }],
      diff: DIFF,
      llm: mock,
      model: 'cheap',
    });
    const sent = JSON.stringify(mock.calls);
    for (const label of ['pr-description', 'linked-issue', 'commits', 'changed-files', 'spec:docs/plans/p.md']) {
      expect(sent).toContain(`<untrusted source=\\"${label}\\">`);
    }
  });

  it('caps a confident model against thin evidence', async () => {
    // Model claims "high"; there is no spec and no ticket, so it must land lower.
    const res = await classifyIntent({
      title: 'T',
      body: 'a description',
      diff: DIFF,
      llm: llm(MODEL_FIXTURE),
      model: 'cheap',
    });
    expect(res.modelBand).toBe('high');
    expect(res.evidenceTier).toBe('medium');
    expect(res.intent.confidence).toBe('medium');
  });

  it('reports the header-only token saving', async () => {
    const res = await classifyIntent({
      title: 'T',
      diff: DIFF,
      llm: llm(),
      model: 'cheap',
    });
    expect(res.fullDiffTokens).toBe(10_000);
    expect(res.headerOnlyTokens).toBeLessThan(res.fullDiffTokens);
    expect(res.savedTokens).toBe(res.fullDiffTokens - res.headerOnlyTokens);
    expect(res.savedPct).toBeGreaterThan(80);
  });

  it('asks for zero temperature and the PrIntent schema', async () => {
    const mock = llm();
    await classifyIntent({ title: 'T', diff: DIFF, llm: mock, model: 'cheap-model-id' });
    const req = mock.calls[0]!.req as { temperature?: number; schemaName?: string; model?: string };
    expect(req.temperature).toBe(0);
    expect(req.schemaName).toBe('PrIntent');
    expect(req.model).toBe('cheap-model-id');
  });
});

describe('renderIntentBlock', () => {
  it('renders summary, scope and provenance', () => {
    const block = renderIntentBlock({
      intent: 'Add rate limiting.',
      in_scope: ['middleware'],
      out_of_scope: ['auth'],
      confidence: 'medium',
      sources: ['pr_description', 'file_paths'],
    });
    expect(block).toContain('Summary: Add rate limiting.');
    expect(block).toContain('Author considers focal: middleware');
    expect(block).toContain('Author considers peripheral: auth');
    expect(block).toContain('confidence: medium');
  });

  it('returns undefined for a blank intent, so the prompt section is omitted', () => {
    expect(renderIntentBlock(undefined)).toBeUndefined();
    expect(
      renderIntentBlock({ intent: '   ', in_scope: [], out_of_scope: [] }),
    ).toBeUndefined();
  });
});
