import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { JSONRPCMessage } from '@modelcontextprotocol/server';
import { vi } from 'vitest';
import { createServer } from '../src/server.js';

/**
 * Drive the real server over a real transport.
 *
 * Calling a tool's handler directly would skip the two things most likely to
 * break: the JSON Schema the SDK generates from the zod input, and argument
 * validation. So the tests speak JSON-RPC to an in-memory transport instead.
 */

export interface Harness {
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** Paths requested through the mocked `fetch`, in order. */
  requests: string[];
}

export interface ToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

/** A route table: first matching substring wins. `null` status ⇒ network error. */
export type Routes = { match: string; body?: unknown; status?: number; reject?: Error }[];

export function mockRoutes(routes: Routes): string[] {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(new URL(url).pathname);
      const hit = routes.find((r) => url.includes(r.match));
      if (!hit) throw new Error(`test: no route for ${url}`);
      if (hit.reject) throw hit.reject;
      return new Response(JSON.stringify(hit.body ?? {}), {
        status: hit.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return requests;
}

export async function connect(requests: string[] = []): Promise<Harness> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);

  const pending = new Map<number, (m: unknown) => void>();
  clientSide.onmessage = (m: JSONRPCMessage) => {
    const msg = m as unknown as { id?: number };
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(m);
      pending.delete(msg.id);
    }
  };
  await clientSide.start();

  let id = 0;
  const rpc = <T>(method: string, params?: unknown): Promise<T> =>
    new Promise((resolve) => {
      const thisId = (id += 1);
      pending.set(thisId, resolve as (m: unknown) => void);
      void clientSide.send({ jsonrpc: '2.0', id: thisId, method, ...(params ? { params } : {}) } as never);
    });

  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  void clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

  return {
    requests,
    async call(name, args = {}) {
      const res = await rpc<{ result?: ToolResult; error?: unknown }>('tools/call', {
        name,
        arguments: args,
      });
      if (!res.result) throw new Error(`protocol error: ${JSON.stringify(res.error)}`);
      return res.result;
    },
  };
}

/** The concatenated text of a tool result — what the model actually reads. */
export const textOf = (r: ToolResult): string =>
  (r.content ?? []).map((c) => c.text ?? '').join('\n');
