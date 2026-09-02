import type { Finding } from './contracts.js';

export interface GroundingResult {
  survived: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

export function ground(findings: Finding[], diff: string): GroundingResult {
  const survived: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const f of findings) {
    if (!diff.includes(f.path)) {
      dropped.push({ finding: f, reason: 'path not in diff' });
      continue;
    }
    if (f.line < 1) {
      dropped.push({ finding: f, reason: 'no line anchor' });
      continue;
    }
    survived.push(f);
  }

  return { survived, dropped };
}
