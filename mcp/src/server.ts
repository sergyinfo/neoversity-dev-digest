/**
 * The MCP server factory.
 *
 * Split out of `index.ts` deliberately: `serveStdio` seizes `process.stdin` and
 * `process.stdout` the moment it runs, so a module that calls it at import time
 * cannot be imported by a test. Everything testable — the tool registry, the
 * instructions string, the generated schemas — lives here; `index.ts` does
 * nothing but wire this to stdio.
 *
 * `serveStdio` pins one instance per connection, so this must stay a factory
 * with no module-scope mutable state.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunReview } from './tools/run-review.js';

/**
 * Loaded into context at session start even when tool definitions are deferred,
 * and truncated at 2 KB by Claude Code. Keep it short and put the "when to reach
 * for this" first — that is what tool search matches on.
 */
export const INSTRUCTIONS = [
  'DevDigest is a local AI pull-request reviewer.',
  'Search these tools when asked to review a pull request with a DevDigest agent, to read the',
  "findings of a review already run, to look up a repository's extracted house conventions, or",
  'to see the blast radius of a change. Repositories are addressed as "owner/name" and pull',
  'requests by their GitHub number — never by internal id. Requires the DevDigest API to be',
  'running (default http://localhost:3001).',
].join(' ');

/**
 * Registration order is fixed and load-bearing: the MCP spec asks servers to
 * return tools deterministically because a stable `tools/list` lets clients
 * cache it and improves LLM prompt-cache hit rates.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'devdigest', version: '0.0.1' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  registerListAgents(server);
  registerRunReview(server);
  registerGetFindings(server);
  registerGetConventions(server);
  registerGetBlastRadius(server);

  return server;
}
