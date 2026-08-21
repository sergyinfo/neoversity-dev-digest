import type { Intent } from '@devdigest/shared';

/**
 * Render the intent block injected into the review prompt.
 *
 * Its own file, importing nothing but the contract, so the reviews module can
 * use it without creating a module cycle (`intent/service.ts` already depends on
 * `reviews/diff-loader.ts`). One renderer, so what the reviewer sees can never
 * drift from what the classifier produced.
 *
 * The wording is deliberately attributive — "Author considers focal" rather than
 * "in scope" — because this text is derived from author-controlled input. It
 * describes a claim; it does not grant permission. The caller wraps it as
 * `<untrusted source="pr-intent">`.
 */
export function renderIntentBlock(intent: Intent | undefined | null): string | undefined {
  if (!intent || !intent.intent.trim()) return undefined;
  const lines = [`Summary: ${intent.intent}`];
  if (intent.in_scope.length > 0) {
    lines.push(`Author considers focal: ${intent.in_scope.join(', ')}`);
  }
  if (intent.out_of_scope.length > 0) {
    lines.push(`Author considers peripheral: ${intent.out_of_scope.join(', ')}`);
  }
  if (intent.confidence) {
    const from = intent.sources?.length ? intent.sources.join(', ') : 'indirect signals';
    lines.push(`Derived from: ${from} (confidence: ${intent.confidence})`);
  }
  return lines.join('\n');
}
