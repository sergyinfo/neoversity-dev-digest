import { readFileSync } from 'node:fs';

import { ground } from './grounding.js';
import type { AgentSpec, LLMProvider, ReviewResult } from './contracts.js';

export async function review(
  llm: LLMProvider,
  agent: AgentSpec,
  diff: string
): Promise<ReviewResult> {
  const skillBodies = agent.skills.map((slug) =>
    readFileSync(`${process.cwd()}/.claude/skills/${slug}/SKILL.md`, 'utf8')
  );

  const response = await llm.complete({
    system: `${agent.systemPrompt}\n\n${skillBodies.join('\n\n')}`,
    user: diff,
  });

  const { survived } = ground(response.findings, diff);

  const score = Math.round(response.confidence * 100);
  const verdict =
    survived.some((f) => f.severity === 'high') ? 'request_changes'
    : survived.length > 0 ? 'comment'
    : 'approve';

  return { verdict, score, findings: survived };
}
