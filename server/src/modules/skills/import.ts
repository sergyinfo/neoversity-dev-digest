import { ValidationError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';

/**
 * L02 — import a skill from a URL.
 *
 * Accepts a raw markdown document, optionally with YAML frontmatter in the
 * `SKILL.md` shape (`name`, `description`). Frontmatter is parsed with a narrow
 * line reader rather than a YAML dependency: we want exactly two scalar keys,
 * and a full parser would accept anchors, aliases and tags from a remote
 * document we do not control.
 *
 * TRUST MODEL — read before extending this.
 *
 * A skill body is INSTRUCTIONS, not data. `assemblePrompt` deliberately does NOT
 * wrap it in `<untrusted>` the way it wraps the diff, PR description and specs
 * (`reviewer-core/src/prompt.ts:109`) — wrapping would tell the model to ignore
 * it, which is the opposite of what a skill is for. So the injection guard does
 * not cover this text, and `prompt.ts:42` says as much: community skills are to
 * be "sanitized upstream". Upstream is here.
 *
 * What is enforced here today: a 10s timeout, a 64 KB cap, and frontmatter read
 * by a narrow line parser rather than a YAML dependency (a full parser would
 * accept anchors, aliases and tags from a document we do not control).
 *
 * What is NOT enforced, and is a real gap: the fetched text is stored verbatim.
 * Importing a URL is therefore as trusted an act as pasting the same text into
 * the skill editor by hand. Do not expose this endpoint to anyone you would not
 * let edit an agent's system prompt.
 */

const FETCH_TIMEOUT_MS = 10_000;
/** Generous for a skill, small enough that one import cannot blow a prompt. */
const MAX_BODY_BYTES = 64 * 1024;

export interface FetchedSkill {
  name: string;
  description: string;
  body: string;
}

/** GitHub blob URLs render HTML; rewrite to raw so an import of a normal link works. */
function toRawUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}`;
  }
  return url;
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: text };

  const meta: Record<string, string> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]!] = m[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: text.slice(end + 4).trimStart() };
}

/** Fall back to the filename when the document carries no frontmatter name. */
function nameFromUrl(url: string): string {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'imported-skill';
  return last.replace(/\.(md|markdown|txt)$/i, '') || 'imported-skill';
}

export async function fetchSkillFromUrl(url: string): Promise<FetchedSkill> {
  const target = toRawUrl(url);

  let res: Response;
  try {
    res = await withTimeout(fetch(target, { redirect: 'follow' }), FETCH_TIMEOUT_MS);
  } catch {
    throw new ValidationError(`Could not fetch ${target}`);
  }
  if (!res.ok) throw new ValidationError(`Fetching ${target} returned ${res.status}`);

  const text = await res.text();
  if (!text.trim()) throw new ValidationError('The fetched document is empty');
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    throw new ValidationError(`Skill body exceeds ${MAX_BODY_BYTES / 1024} KB`);
  }

  const { meta, body } = parseFrontmatter(text);
  if (!body.trim()) throw new ValidationError('The fetched document has no body');

  return {
    name: meta.name ?? nameFromUrl(target),
    description: meta.description ?? `Imported from ${target}`,
    body,
  };
}
