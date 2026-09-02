import { describe, expect, it } from 'vitest';

import { renderOutcome } from '../src/format.js';

describe('renderOutcome', () => {
  it('caps the finding list', () => {
    const findings = Array.from({ length: 40 }, (_, i) => ({
      path: `src/a${i}.ts`,
      line: i,
      message: 'x',
    }));
    const out = renderOutcome({ verdict: 'comment', score: 60, findings });
    expect(out).toContain('… 15 more');
  });

  it('renders the verdict line first', () => {
    const out = renderOutcome({ verdict: 'approve', score: 100, findings: [] });
    expect(out.split('\n')[0]).toBe('verdict: approve  score: 100');
  });
});
