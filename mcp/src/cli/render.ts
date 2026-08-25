import type { Finding, ReviewRecord, RunSummary, Severity } from '@devdigest/shared';

/** Terminal rendering. Plain text, no colour library, no dependency. */

const ORDER: Severity[] = ['CRITICAL', 'WARNING', 'SUGGESTION'];

/** ANSI only when stdout is a TTY — piping into a file or CI keeps it clean. */
const tty = process.stdout.isTTY === true;
const paint = (code: string, s: string) => (tty ? `[${code}m${s}[0m` : s);

const SEV_COLOUR: Record<Severity, string> = {
  CRITICAL: '31;1',
  WARNING: '33',
  SUGGESTION: '36',
};

export function renderFindings(reviews: ReviewRecord[], runs: RunSummary[]): string {
  const all = reviews
    .flatMap((r) => r.findings.map((f) => ({ ...f, agent: r.agent_name ?? 'agent' })))
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

  const lines: string[] = [];

  for (const sev of ORDER) {
    const group = all.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push('');
    lines.push(paint(SEV_COLOUR[sev], `${sev} (${group.length})`));
    for (const f of group) lines.push(`  ${location(f)}  ${f.title}  ${paint('2', `[${f.agent}]`)}`);
  }

  lines.push('');
  for (const run of runs) {
    const bits = [
      run.agent_name ?? 'agent',
      run.status === 'done' ? `score ${run.score ?? '—'}` : `run ${run.status}`,
      `${run.findings_count ?? 0} finding(s)`,
      `${run.blockers ?? 0} blocker(s)`,
      run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : null,
    ].filter(Boolean);
    lines.push(paint('2', `  ${bits.join(' · ')}`));
  }

  return lines.join('\n');
}

/** `path:line` — the form an editor and a terminal both know how to open. */
function location(f: Finding): string {
  return f.start_line > 0 ? `${f.file}:${f.start_line}` : f.file;
}
