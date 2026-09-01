import { describe, expect, it } from 'vitest';

import { capList, capText } from '../src/format.js';
import { runReviewTool } from '../src/tools/run-review.js';
import { listPullsTool } from '../src/tools/list-pulls.js';

describe('context budget', () => {
  it('caps list output', () => {
    const { items, truncated } = capList(Array.from({ length: 100 }, (_, i) => i));
    expect(items).toHaveLength(25);
    expect(truncated).toBe(true);
  });

  it('caps text output', () => {
    const { text, truncated } = capText('x'.repeat(20000));
    expect(text.length).toBeLessThanOrEqual(8002);
    expect(truncated).toBe(true);
  });

  it('keeps tool descriptions to one line', () => {
    for (const tool of [runReviewTool, listPullsTool]) {
      expect(tool.description.split('\n')).toHaveLength(1);
      expect(tool.description.length).toBeLessThan(120);
    }
  });
});
