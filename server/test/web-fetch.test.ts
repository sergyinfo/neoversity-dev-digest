import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HttpWebFetchClient, isPrivateAddress } from '../src/adapters/http/web-fetch.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';

/**
 * Hermetic: `globalThis.fetch` is stubbed, so nothing leaves the machine. The
 * DNS guard is exercised through real resolution of public/loopback names only.
 */

const textResponse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/markdown', ...headers } });

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('rejects %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '2606:4700::1111'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it('treats a non-IP string as unsafe (caller must resolve first)', () => {
    expect(isPrivateAddress('example.com')).toBe(true);
  });
});

describe('HttpWebFetchClient', () => {
  const client = new HttpWebFetchClient();
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-https schemes without issuing a request', async () => {
    await expect(client.fetch('http://example.com/plan.md')).rejects.toThrow(/Only https/);
    await expect(client.fetch('file:///etc/passwd')).rejects.toThrow(/Only https/);
    await expect(client.fetch('not a url')).rejects.toThrow(/valid URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects private-address literals without issuing a request', async () => {
    await expect(client.fetch('https://127.0.0.1/plan.md')).rejects.toThrow(/private address/);
    await expect(client.fetch('https://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private address/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to loopback', async () => {
    // `localhost` resolves to 127.0.0.1/::1 on every supported platform, so this
    // covers the DNS branch (not just the IP-literal branch) with no network.
    await expect(client.fetch('https://localhost/plan.md')).rejects.toThrow(
      /private address|Could not resolve/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the body for an allowed text/* document', async () => {
    fetchSpy.mockResolvedValue(textResponse('# Plan\n\nAdd rate limiting.'));
    await expect(client.fetch('https://8.8.8.8/plan.md')).resolves.toContain('Add rate limiting');
  });

  it('rejects a non-text content type', async () => {
    fetchSpy.mockResolvedValue(
      new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    await expect(client.fetch('https://8.8.8.8/plan.pdf')).rejects.toThrow(/text\/\*/);
  });

  it('rejects an oversized body, by declared length and by stream', async () => {
    fetchSpy.mockResolvedValue(
      textResponse('x', { 'content-length': String(200 * 1024) }),
    );
    await expect(client.fetch('https://8.8.8.8/big.md')).rejects.toThrow(/exceeds/);

    fetchSpy.mockResolvedValue(textResponse('x'.repeat(150 * 1024)));
    await expect(client.fetch('https://8.8.8.8/big2.md')).rejects.toThrow(/exceeds/);
  });

  it('re-validates redirects — a 302 to the metadata service is refused', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/creds' } }),
    );
    await expect(client.fetch('https://8.8.8.8/plan.md')).rejects.toThrow(/private address/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows an allowed redirect', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://1.1.1.1/final.md' } }),
      )
      .mockResolvedValueOnce(textResponse('final body'));
    await expect(client.fetch('https://8.8.8.8/plan.md')).resolves.toBe('final body');
  });

  it('gives up after too many redirects', async () => {
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/loop' } }),
    );
    await expect(client.fetch('https://8.8.8.8/loop')).rejects.toThrow(/Too many redirects/);
  });
});

describe('container.webFetch gating', () => {
  const db = {} as Db;

  it('throws ConfigError when the flag is off (default)', () => {
    const c = new Container(loadConfig({ NODE_ENV: 'test' }), db);
    expect(() => c.webFetch).toThrow(/INTENT_EXTERNAL_FETCH_ENABLED/);
  });

  it('constructs the real client when the flag is on', () => {
    const c = new Container(
      loadConfig({ NODE_ENV: 'test', INTENT_EXTERNAL_FETCH_ENABLED: 'true' }),
      db,
    );
    expect(c.webFetch).toBeInstanceOf(HttpWebFetchClient);
  });

  it('an override wins over the flag, so tests never need the env', () => {
    const stub = { fetch: async () => 'stubbed' };
    const c = new Container(loadConfig({ NODE_ENV: 'test' }), db, { webFetch: stub });
    expect(c.webFetch).toBe(stub);
  });
});
