import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Risk, RiskSeverity } from '@devdigest/shared';
import { toJsonSchema } from '@devdigest/reviewer-core';
import {
  ModelBrief,
  BriefDocument,
  ReviewFocus,
  BriefFingerprint,
  MovedInput,
  BriefInput,
  SkippedSource,
  BriefProvenance,
  BriefResponse,
} from '../src/modules/brief/contract.js';

/**
 * L05 contract tests — the module-local brief envelope (spec D-10).
 *
 * Two jobs: parse a fixture of every shape, and hold the D-10 boundary — that
 * `Risk`/`RiskSeverity` are IMPORTED from `@devdigest/shared` rather than
 * restated here, and that nothing else is taken from that package.
 */

const CONTRACT_PATH = fileURLToPath(new URL('../src/modules/brief/contract.ts', import.meta.url));
const source = readFileSync(CONTRACT_PATH, 'utf8');

const risk: Risk = {
  kind: 'secret',
  title: 'API token committed to the repository',
  explanation: 'The literal is a live credential and survives in git history.',
  severity: 'high',
  file_refs: ['src/config.ts'],
};

const modelBrief: ModelBrief = {
  what: 'Adds a PR brief endpoint and widens the pr_brief record.',
  why: 'Reviewers open a PR with no statement of what it changes or why.',
  risk_level: 'medium',
  risks: [risk],
  review_focus: [
    { file: 'src/config.ts', line: 42, reason: 'Where the token literal lands.' },
    { file: 'src/modules/brief/contract.ts', reason: 'The new envelope, no line anchor.' },
  ],
};

const fingerprint: BriefFingerprint = { local: 'a'.repeat(64), remote: 'b'.repeat(64) };

const provenance: BriefProvenance = {
  inputs_used: ['intent', 'blast', 'diff'],
  references_used: ['docs/plans/pr-why-risk-brief.md', 'acme/web#41'],
  references_skipped: [{ source: 'https://example.com/spec', reason: 'external fetch disabled' }],
  dropped_items: [{ source: 'docs/adr/0007.md', reason: 'budget' }],
  estimated_input_tokens: 7412,
  tokens_in: 7550,
  tokens_out: 612,
  cost_usd: 0.0134,
  discarded_refs: 2,
  model: 'gpt-4.1',
  blast_state: 'partial',
  changed_files: { listed: 60, total: 312 },
};

const response: BriefResponse = {
  ...modelBrief,
  state_fingerprint: fingerprint,
  inputs_used: provenance.inputs_used,
  references_used: provenance.references_used,
  references_skipped: provenance.references_skipped,
  discarded_refs: 2,
  blast_state: provenance.blast_state ?? null,
  changed_files: provenance.changed_files ?? null,
  model: 'gpt-4.1',
  cost_usd: 0.0134,
  tokens_in: 7550,
  tokens_out: 612,
  generated_at: '2026-08-27T10:15:00.000Z',
  out_of_date: true,
  moved_inputs: ['head_sha', 'indexed_sha'],
};

describe('brief contract — fixtures parse', () => {
  it('ModelBrief parses the model output shape', () => {
    const r = ModelBrief.safeParse(modelBrief);
    expect(r.success).toBe(true);
  });

  it('ReviewFocus accepts an entry with no line, and rejects a non-integer line', () => {
    expect(ReviewFocus.safeParse({ file: 'a.ts', reason: 'why' }).success).toBe(true);
    expect(ReviewFocus.safeParse({ file: 'a.ts', line: null, reason: 'why' }).success).toBe(true);
    expect(ReviewFocus.safeParse({ file: 'a.ts', line: 1.5, reason: 'why' }).success).toBe(false);
  });

  it('ModelBrief rejects a risk_level outside the shared RiskSeverity vocabulary', () => {
    const r = ModelBrief.safeParse({ ...modelBrief, risk_level: 'critical' });
    expect(r.success).toBe(false);
  });

  it('BriefDocument is the grounded ModelBrief — same shape', () => {
    expect(BriefDocument.safeParse(modelBrief).success).toBe(true);
  });

  it('BriefFingerprint carries a local and a remote digest', () => {
    const r = BriefFingerprint.safeParse(fingerprint);
    expect(r.success).toBe(true);
    expect(BriefFingerprint.safeParse({ local: 'x' }).success).toBe(false);
  });

  it('MovedInput is exhaustive over D-1a’s locally recomputable components', () => {
    expect(MovedInput.options).toEqual([
      'head_sha',
      'intent_derived_at',
      'intent_model',
      'indexed_sha',
      'blast_state',
      'model_provider',
      'model_id',
      'assembler_version',
    ]);
    // The two remote-half components must NOT be nameable by the read marker.
    expect(MovedInput.safeParse('linked_issue_digest').success).toBe(false);
    expect(MovedInput.safeParse('reference_digest').success).toBe(false);
  });

  it('BriefInput names exactly the five sources of §10', () => {
    expect(BriefInput.options).toEqual(['intent', 'blast', 'diff', 'linked_issue', 'references']);
  });

  it('SkippedSource carries a source and a reason', () => {
    expect(SkippedSource.safeParse({ source: 'docs/a.md', reason: 'budget' }).success).toBe(true);
    expect(SkippedSource.safeParse({ source: 'docs/a.md' }).success).toBe(false);
  });

  it('BriefProvenance parses a full record', () => {
    const r = BriefProvenance.safeParse(provenance);
    expect(r.success).toBe(true);
  });

  /**
   * The whole point of `blast_state` / `changed_files` being optional: a
   * `pr_brief` row written before they existed must keep parsing. A required
   * field would make every stored row unreadable, which is served as "nothing
   * is known about this brief" — the F-7 failure, recreated by the F-6 fix.
   */
  it('BriefProvenance still parses a record written before blast_state and changed_files', () => {
    const legacy: Record<string, unknown> = { ...provenance };
    delete legacy.blast_state;
    delete legacy.changed_files;

    const r = BriefProvenance.safeParse(legacy);
    expect(r.success).toBe(true);
    expect(r.success && r.data.blast_state).toBeUndefined();
    expect(r.success && r.data.changed_files).toBeUndefined();
  });

  it('BriefProvenance rejects a blast_state outside the three-state vocabulary', () => {
    expect(BriefProvenance.safeParse({ ...provenance, blast_state: 'unknown' }).success).toBe(
      false,
    );
    expect(BriefProvenance.safeParse({ ...provenance, blast_state: 'full' }).success).toBe(false);
  });

  it('BriefResponse distinguishes an unrecorded impact input from a degraded one', () => {
    // Both are "no impact map to lean on", and they are NOT the same claim:
    // `degraded` knows the repository has no usable index, `null` knows
    // nothing at all. Only the first may be rendered as a fact about the index.
    const unrecorded = BriefResponse.parse({
      ...response,
      inputs_used: null,
      blast_state: null,
      changed_files: null,
    });
    expect(unrecorded.blast_state).toBeNull();
    expect(unrecorded.inputs_used).toBeNull();

    const degraded = BriefResponse.parse({ ...response, blast_state: 'degraded' });
    expect(degraded.blast_state).toBe('degraded');

    // …and the key itself is still required: a response that simply omits it
    // must fail rather than arrive as `undefined` at the card.
    const missing: Record<string, unknown> = { ...response };
    delete missing.blast_state;
    expect(BriefResponse.safeParse(missing).success).toBe(false);
  });

  it('BriefProvenance accepts null cost and null token counts', () => {
    const r = BriefProvenance.safeParse({
      ...provenance,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      model: null,
    });
    expect(r.success).toBe(true);
  });

  it('BriefResponse parses §10’s full field table', () => {
    const r = BriefResponse.safeParse(response);
    expect(r.success).toBe(true);
  });

  it('BriefResponse carries the document fields alongside the metadata', () => {
    const r = BriefResponse.parse(response);
    expect(r.what).toBe(modelBrief.what);
    expect(r.risks[0]?.severity).toBe('high');
    expect(r.state_fingerprint.remote).toBe(fingerprint.remote);
    expect(r.moved_inputs).toEqual(['head_sha', 'indexed_sha']);
  });

  it('BriefResponse requires every §10 field marked required', () => {
    for (const field of [
      'what',
      'why',
      'risk_level',
      'risks',
      'review_focus',
      'state_fingerprint',
      'inputs_used',
      'discarded_refs',
      'generated_at',
      'out_of_date',
    ]) {
      const partial: Record<string, unknown> = { ...response };
      delete partial[field];
      expect(BriefResponse.safeParse(partial).success, `${field} must be required`).toBe(false);
    }
  });
});

describe('brief contract — D-10 boundary', () => {
  it('imports Risk from @devdigest/shared rather than restating it', () => {
    // The shared schema is the one the envelope uses: a fixture that satisfies
    // `Risk` must satisfy the risks array, and a shape that does not must fail.
    expect(Risk.safeParse(risk).success).toBe(true);
    expect(ModelBrief.shape.risks.element).toBe(Risk);
    expect(ModelBrief.shape.risk_level).toBe(RiskSeverity);
  });

  it('declares no local copy of Risk / RiskSeverity', () => {
    expect(source).not.toMatch(/export const Risk\b/);
    expect(source).not.toMatch(/export const RiskSeverity\b/);
    expect(source).not.toMatch(/z\.enum\(\[\s*'high',\s*'medium',\s*'low'\s*\]\)/);
  });

  it('takes nothing from @devdigest/shared except Risk and RiskSeverity', () => {
    const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@devdigest\/shared'/g)];
    expect(imports).toHaveLength(1);
    const named = imports[0]![1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(named).toEqual(['Risk', 'RiskSeverity']);
  });

  it('does not reach into vendor/shared by path', () => {
    // Prose in the header comment names the directory on purpose (that is the
    // D-10 rationale); what must not exist is an IMPORT that bypasses the
    // `@devdigest/shared` alias and reaches the vendored copy by path.
    const specifiers = [...source.matchAll(/\bfrom\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(specifiers).toEqual(['zod', '@devdigest/shared']);
    expect(specifiers.some((s) => s.includes('vendor/shared'))).toBe(false);
  });
});

describe('brief contract — ModelBrief is usable as a structured-output schema', () => {
  it('converts to a strict JSON schema whose optional line is nullable, not bare optional', () => {
    const { schema } = toJsonSchema(ModelBrief, 'ModelBrief');

    // Strict mode requires every property to be listed as required.
    const required = (schema as { required?: string[] }).required ?? [];
    expect([...required].sort()).toEqual(['review_focus', 'risk_level', 'risks', 'what', 'why']);

    // A bare `.optional()` here would emit `{type: 'integer'}`, which the
    // OpenAI helper warns about and the API rejects. `.nullish()` gives an
    // explicit null branch.
    const line = (
      schema as {
        properties: {
          review_focus: { items: { properties: { line: { anyOf?: { type: string }[] } } } };
        };
      }
    ).properties.review_focus.items.properties.line;
    expect(line.anyOf?.map((b) => b.type).sort()).toEqual(['integer', 'null']);
  });
});
