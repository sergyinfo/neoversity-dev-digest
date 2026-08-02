import type { ConventionCandidate } from '@devdigest/shared';

/**
 * L02 — render accepted conventions into one skill body.
 *
 * Pure: takes rows, returns markdown. No DB, no model. The body is what an agent
 * is actually told, so it is written as instructions ("flag changes that…"),
 * not as a description of the repo.
 */

/** `Always use async/await…` → `always-use-async-await` */
function slug(rule: string): string {
  return (
    rule
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-') || 'rule'
  );
}

function fence(snippet: string): string {
  // A snippet containing ``` would break out of the block and let repo content
  // pose as instructions; widen the fence until it cannot.
  let ticks = '```';
  while (snippet.includes(ticks)) ticks += '`';
  return `${ticks}\n${snippet.trim()}\n${ticks}`;
}

export function renderSkillBody(
  repoName: string,
  accepted: Pick<
    ConventionCandidate,
    'rule' | 'category' | 'evidence_path' | 'evidence_snippet' | 'start_line' | 'end_line'
  >[],
): string {
  const header = [
    `# ${repoName}-conventions`,
    '',
    `House conventions for \`${repoName}\`, extracted from the repository and reviewed by a human.`,
    'Flag changes that violate any rule below and cite the offending `file:line`.',
    '',
  ];

  const sections = accepted.map((c) => {
    const range =
      c.start_line != null ? `${c.evidence_path}:${c.start_line}-${c.end_line ?? c.start_line}` : c.evidence_path;
    return [
      `## ${slug(c.rule)}`,
      c.category ? `_${c.category}_` : null,
      c.rule,
      '',
      `Detected in \`${range}\`:`,
      fence(c.evidence_snippet),
    ]
      .filter((l) => l !== null)
      .join('\n');
  });

  return [...header, sections.join('\n\n'), ''].join('\n');
}

/** Default skill name for a repo's conventions — stable, so re-runs collide loudly. */
export function conventionsSkillName(repoName: string): string {
  return `${repoName}-conventions`;
}
