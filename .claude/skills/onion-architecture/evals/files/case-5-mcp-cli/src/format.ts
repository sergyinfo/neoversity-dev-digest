const MAX_FINDINGS = 25;

export function renderOutcome(outcome: {
  verdict: string;
  score: number;
  findings: { path: string; line: number; message: string }[];
}): string {
  const shown = outcome.findings.slice(0, MAX_FINDINGS);
  const lines = [
    `verdict: ${outcome.verdict}  score: ${outcome.score}`,
    '',
    ...shown.map((f) => `${f.path}:${f.line}  ${f.message}`),
  ];

  if (outcome.findings.length > shown.length) {
    lines.push(`… ${outcome.findings.length - shown.length} more`);
  }

  return lines.join('\n');
}
