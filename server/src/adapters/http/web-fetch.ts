import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { WebFetchClient } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

/**
 * Guarded outbound HTTP for the Intent Layer.
 *
 * The URL here comes out of a PR description — i.e. it is chosen by whoever
 * opened the pull request. Fetching it makes this server a request proxy on
 * their behalf, so this adapter is written as an SSRF boundary first and a
 * fetcher second.
 *
 * NOT lifted from `modules/skills/import.ts`: that path deliberately has only a
 * timeout and a size cap, and says so in its own trust-model comment. There was
 * no existing guard to reuse.
 *
 * Enforced here:
 *  - https only (no http, file:, gopher:, data:, …)
 *  - the resolved IP must be public — literals AND DNS results are checked, so
 *    `evil.com → 127.0.0.1` is rejected, not just a literal `127.0.0.1`
 *  - redirects are followed MANUALLY, re-validating every hop (a 302 to
 *    169.254.169.254 is the classic cloud-metadata escape)
 *  - request timeout, `text/*` content type, and a hard body cap read from the
 *    stream so an attacker cannot stream gigabytes into memory
 *
 * Known residual risk: DNS rebinding. We resolve, validate, then let `fetch`
 * resolve again, so a TTL-0 record can in principle flip between the two. Fully
 * closing it needs connect-time pinning to the validated IP, which Node's fetch
 * does not expose. Accepted, and the reason the whole capability is behind
 * INTENT_EXTERNAL_FETCH_ENABLED (default off).
 */

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 100 * 1024;
const MAX_REDIRECTS = 3;

/** Private, loopback, link-local and other non-routable IPv4/IPv6 ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase();
    if (ip6 === '::' || ip6 === '::1') return true;
    if (ip6.startsWith('fe80') || ip6.startsWith('fc') || ip6.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:127.0.0.1) — validate the embedded v4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip6);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }
  // Not an IP literal at all — caller must resolve first.
  return true;
}

/** Reject anything that is not an https URL pointing at a public address. */
async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError(`Only https URLs may be fetched (got ${url.protocol})`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new ValidationError(`Refusing to fetch a private address: ${host}`);
    }
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new ValidationError(`Could not resolve ${host}`);
  }
  if (addrs.length === 0) throw new ValidationError(`Could not resolve ${host}`);
  // EVERY resolved address must be public — one private A record is enough to
  // reach an internal service, so "any public address" would not be safe.
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new ValidationError(`${host} resolves to a private address (${address})`);
    }
  }
  return url;
}

/** Read at most `MAX_BODY_BYTES` from the response, without buffering the rest. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    throw new ValidationError(`Document exceeds ${MAX_BODY_BYTES / 1024} KB`);
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        throw new ValidationError(`Document exceeds ${MAX_BODY_BYTES / 1024} KB`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

export class HttpWebFetchClient implements WebFetchClient {
  async fetch(rawUrl: string): Promise<string> {
    let target = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Re-validated per hop: the guard is worthless if a redirect can bypass it.
      const url = await assertPublicHttpsUrl(target);

      let res: Response;
      try {
        res = await globalThis.fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { accept: 'text/plain, text/markdown, text/*;q=0.9' },
        });
      } catch (err) {
        throw new ValidationError(`Could not fetch ${url.href}: ${(err as Error).message}`);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new ValidationError(`${url.href} redirected without a Location`);
        target = new URL(location, url).href;
        continue;
      }
      if (!res.ok) throw new ValidationError(`Fetching ${url.href} returned ${res.status}`);

      const ctype = res.headers.get('content-type') ?? '';
      if (!ctype.toLowerCase().startsWith('text/')) {
        throw new ValidationError(`Expected a text/* document, got "${ctype || 'none'}"`);
      }
      return await readCapped(res);
    }
    throw new ValidationError(`Too many redirects fetching ${rawUrl}`);
  }
}
