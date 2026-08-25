import { describe, it, expect, beforeAll } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { JSONRPCMessage } from '@modelcontextprotocol/server';
import { createServer, INSTRUCTIONS } from '../src/server.js';

/**
 * The context budget, as a regression gate rather than a one-off measurement.
 *
 * Claude Code's tool search loads only tool NAMES and the server `instructions`
 * at session start, and truncates both descriptions and instructions at 2 KB
 * each. When tools are NOT deferred, the whole `tools/list` payload is what a
 * session pays before the user types anything — so it gets a ceiling here, and
 * the measured numbers are printed for `mcp/README.md` to quote.
 *
 * These thresholds encode external product behaviour, not repo facts. If Claude
 * Code's limits move, change them here, in one place.
 */

const INSTRUCTIONS_MIN = 400;
const INSTRUCTIONS_MAX = 600;
const HARD_2KB = 2048;
const TOOLS_LIST_MAX_CHARS = 4200; // ≈ 1 050 tokens

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { description?: string }> };
  outputSchema?: unknown;
}

let tools: ToolDef[];
let payload: string;

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);

  const pending = new Map<number, (m: Record<string, never>) => void>();
  clientSide.onmessage = (m: JSONRPCMessage) => {
    const msg = m as unknown as { id?: number };
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(m as never);
      pending.delete(msg.id);
    }
  };
  await clientSide.start();

  const call = (id: number, method: string, params?: unknown) =>
    new Promise<{ result: { tools: ToolDef[] } }>((resolve) => {
      pending.set(id, resolve as never);
      void clientSide.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as never);
    });

  await call(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'budget', version: '0' },
  });
  void clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

  const listed = await call(2, 'tools/list');
  tools = listed.result.tools;
  payload = JSON.stringify(tools);

  // Printed so the numbers quoted in mcp/README.md can be copied from a run.
  console.error(
    `[budget] instructions=${INSTRUCTIONS.length} chars · ` +
      `tools/list=${payload.length} chars ≈ ${Math.round(payload.length / 4)} tokens · ` +
      `tools=${tools.length}`,
  );
});

describe('context budget', () => {
  it('registers exactly the five tools, in a deterministic order', () => {
    // The MCP spec asks for a stable order: it lets clients cache `tools/list`
    // and improves prompt-cache hit rates.
    expect(tools.map((t) => t.name)).toEqual([
      'list_agents',
      'run_review',
      'get_findings',
      'get_conventions',
      'get_blast_radius',
    ]);
  });

  it('keeps `instructions` inside the window and far under the 2 KB truncation', () => {
    expect(INSTRUCTIONS.length).toBeGreaterThanOrEqual(INSTRUCTIONS_MIN);
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX);
    expect(INSTRUCTIONS.length).toBeLessThan(HARD_2KB);
  });

  it('keeps every tool description under the 2 KB truncation', () => {
    for (const t of tools) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.description!.length, t.name).toBeLessThan(HARD_2KB);
    }
  });

  it(`keeps the whole tools/list payload under ${TOOLS_LIST_MAX_CHARS} chars`, () => {
    expect(payload.length).toBeLessThanOrEqual(TOOLS_LIST_MAX_CHARS);
  });

  it('declares no outputSchema — pure upfront cost for prose results', () => {
    for (const t of tools) expect(t.outputSchema, t.name).toBeUndefined();
  });

  it('describes every parameter of every tool', () => {
    for (const t of tools) {
      for (const [param, schema] of Object.entries(t.inputSchema?.properties ?? {})) {
        expect(schema.description, `${t.name}.${param}`).toBeTruthy();
      }
    }
  });
});
