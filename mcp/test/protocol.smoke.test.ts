import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { JSONRPCMessage } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';

/**
 * The protocol itself: a full handshake over a real transport, with nothing
 * mocked but `fetch`.
 *
 * The other suites drive tools through this same machinery; this one asserts the
 * machinery — that `initialize` negotiates, that the server advertises `tools`,
 * that an unknown tool is a PROTOCOL error (not an `isError` result), and that
 * discovery touches no network at all.
 */

interface Rpc {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function session() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);

  const pending = new Map<number, (m: Rpc) => void>();
  clientSide.onmessage = (m: JSONRPCMessage) => {
    const msg = m as unknown as Rpc;
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  };
  await clientSide.start();

  let id = 0;
  const rpc = (method: string, params?: unknown): Promise<Rpc> =>
    new Promise((resolve) => {
      const thisId = (id += 1);
      pending.set(thisId, resolve);
      void clientSide.send({ jsonrpc: '2.0', id: thisId, method, ...(params ? { params } : {}) } as never);
    });

  const notify = (method: string) =>
    clientSide.send({ jsonrpc: '2.0', method } as never);

  return { rpc, notify };
}

afterEach(() => vi.unstubAllGlobals());

describe('protocol handshake', () => {
  it('negotiates a protocol version and advertises the tools capability', async () => {
    const { rpc } = await session();
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    });

    expect(init.error).toBeUndefined();
    expect(init.result?.protocolVersion).toBeTruthy();
    expect((init.result?.capabilities as Record<string, unknown>)?.tools).toBeDefined();
    expect((init.result?.serverInfo as Record<string, string>)?.name).toBe('devdigest');
    expect(init.result?.instructions).toBeTruthy();
  });

  it('lists the five tools with a JSON Schema each, touching no network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { rpc, notify } = await session();
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    });
    void notify('notifications/initialized');

    const listed = await rpc('tools/list');
    const tools = listed.result?.tools as { name: string; inputSchema?: { type?: string } }[];

    expect(tools).toHaveLength(5);
    for (const t of tools) expect(t.inputSchema?.type, t.name).toBe('object');
    // Discovery is free: a session that never calls a tool costs zero requests.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('error surfaces are the right KIND of error', () => {
  it('an unknown tool is a PROTOCOL error, not an isError result', async () => {
    const { rpc, notify } = await session();
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    });
    void notify('notifications/initialized');

    const res = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });

    // Per the MCP spec, a model cannot self-correct its way out of a tool that
    // does not exist — that is a protocol error. A missing ARGUMENT, by
    // contrast, is a tool execution error it can retry (covered in tools.test).
    expect(res.error).toBeDefined();
    expect(res.result).toBeUndefined();
  });

  it('a wrongly-TYPED argument is caught before the handler runs', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { rpc, notify } = await session();
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    });
    void notify('notifications/initialized');

    const res = await rpc('tools/call', {
      name: 'get_findings',
      arguments: { repo: 'acme/app', pr: 'seven' },
    });

    const text = ((res.result?.content as { text?: string }[]) ?? [])
      .map((c) => c.text ?? '')
      .join('');
    expect(res.result?.isError).toBe(true);
    expect(text).toMatch(/pr/);
    // Validation happens in the SDK, so the handler never ran and never fetched.
    expect(fetch).not.toHaveBeenCalled();
  });
});
