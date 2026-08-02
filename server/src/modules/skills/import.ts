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
 * The body is TREATED AS UNTRUSTED — it ends up in a model prompt, so it is
 * length-capped here and the prompt assembler wraps it downstream.
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
