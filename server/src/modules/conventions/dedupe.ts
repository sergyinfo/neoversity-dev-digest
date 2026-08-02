import type { VerifiedCandidate } from './verify.js';

/**
 * L02 — collapse candidates that state the same rule.
 *
 * Observed on the first real run: of 13 verified candidates, only 5 were
 * distinct rules — the model restated "database access goes through shared
 * helpers" three times, once per file it saw it in. Each duplicate costs the
 * user a judgement click and makes the generated skill repeat itself.
 *
 * Keeps the highest-confidence instance of each rule and attaches the rest as
 * extra evidence, so nothing is lost: more supporting sites is a REASON to
 * trust a rule, not noise to discard.
 */

export interface DedupedCandidate extends VerifiedCandidate {
  /** Additional `path:start-end` sites where the same rule was observed. */
  also_seen_in: string[];
}

/** Rule text differing only in case, punctuation or backticks is the same rule. */
function ruleKey(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function site(c: VerifiedCandidate): string {
  return c.start_line === c.end_line
    ? `${c.evidence_path}:${c.start_line}`
    : `${c.evidence_path}:${c.start_line}-${c.end_line}`;
}

export function dedupeCandidates(candidates: VerifiedCandidate[]): DedupedCandidate[] {
  const byRule = new Map<string, DedupedCandidate>();

  // Highest confidence first, so the kept instance is the best-evidenced one.
  for (const c of [...candidates].sort((a, b) => b.confidence - a.confidence)) {
    const key = ruleKey(c.rule);
    const existing = byRule.get(key);
    if (!existing) {
      byRule.set(key, { ...c, also_seen_in: [] });
      continue;
    }
    const s = site(c);
    if (s !== site(existing) && !existing.also_seen_in.includes(s)) {
      existing.also_seen_in.push(s);
    }
  }

  return [...byRule.values()];
}
