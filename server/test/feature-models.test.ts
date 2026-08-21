import { describe, it, expect } from 'vitest';
import { FEATURE_MODELS } from '@devdigest/shared';
import { defaultFeatureModel } from '../src/platform/feature-models.js';

/**
 * Hermetic: `DEFAULTS` is derived from the FEATURE_MODELS registry at module
 * load, so the registry default is assertable without touching the DB.
 */
describe('feature-model registry defaults', () => {
  it('review_intent defaults to the cheap OpenRouter model', () => {
    expect(defaultFeatureModel('review_intent')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
  });

  it('every registry entry has a resolvable default', () => {
    for (const f of FEATURE_MODELS) {
      const d = defaultFeatureModel(f.id);
      expect(d.provider).toBe(f.defaultProvider);
      expect(d.model).toBe(f.defaultModel);
      expect(d.model.length).toBeGreaterThan(0);
    }
  });
});
