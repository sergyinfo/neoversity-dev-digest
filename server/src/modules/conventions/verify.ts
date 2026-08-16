/**
 * L02 — the evidence gate.
 *
 * A candidate is only as good as its proof. The model is asked for a file, a
 * line range and the snippet it saw; this checks all three against the clone.
 *
 * The third check is the one that matters. "File exists" and "line range is in
 * bounds" are easy to satisfy by accident — a model that guesses a plausible
 * path and a small line number passes both. Matching the snippet against those
 * exact lines is what proves the evidence was read rather than invented. Same
 * principle as the review pipeline's citation grounding.
 */

export interface RawCandidate {
  category?: string | null;
  rule: string;
  evidence_path: string;
  evidence_snippet: string;
  start_line?: number | null;
  end_line?: number | null;
  confidence: number;
}

export interface VerifiedCandidate extends RawCandidate {
  start_line: number;
  end_line: number;
}

export type RejectReason =
  | 'no-path'
  | 'file-missing'
  | 'bad-range'
  | 'range-out-of-bounds'
  | 'snippet-mismatch';

export interface VerifyOutcome {
  verified: VerifiedCandidate[];
  rejected: { candidate: RawCandidate; reason: RejectReason }[];
}

/** Ignore indentation and blank-line differences — the model reflows whitespace. */
function normalize(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Verify one candidate against file contents.
 *
 * `readFile` returns undefined for a missing file rather than throwing, so one
 * bad path cannot abort a whole extraction run.
 */
export async function verifyCandidate(
  c: RawCandidate,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<{ ok: true; value: VerifiedCandidate } | { ok: false; reason: RejectReason }> {
  const path = (c.evidence_path ?? '').trim();
  if (!path) return { ok: false, reason: 'no-path' };

  const content = await readFile(path);
  if (content === undefined) return { ok: false, reason: 'file-missing' };

  const lines = content.split('\n');
  const start = c.start_line ?? 0;
  const end = c.end_line ?? start;

  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) {
    return { ok: false, reason: 'bad-range' };
  }
  if (end > lines.length) return { ok: false, reason: 'range-out-of-bounds' };

  const snippet = normalize(c.evidence_snippet ?? '');
  if (!snippet) return { ok: false, reason: 'snippet-mismatch' };

  // Compare against the cited range, widened by a couple of lines: models commonly
  // report a range off by one at either edge while quoting the right code. Widening
  // forgives that without accepting a snippet from a different part of the file.
  const from = Math.max(0, start - 1 - 2);
  const to = Math.min(lines.length, end + 2);
  const window = normalize(lines.slice(from, to).join('\n'));

  if (!window.includes(snippet)) return { ok: false, reason: 'snippet-mismatch' };

  return { ok: true, value: { ...c, start_line: start, end_line: end } };
}

export async function verifyAll(
  candidates: RawCandidate[],
  readFile: (path: string) => Promise<string | undefined>,
): Promise<VerifyOutcome> {
  const out: VerifyOutcome = { verified: [], rejected: [] };
  for (const c of candidates) {
    const r = await verifyCandidate(c, readFile);
    if (r.ok) out.verified.push(r.value);
    else out.rejected.push({ candidate: c, reason: r.reason });
  }
  return out;
}
