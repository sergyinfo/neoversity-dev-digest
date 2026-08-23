/**
 * devdigest-mcp — stdio entry point.
 *
 * This file does one thing: hand `createServer` to `serveStdio`. Everything
 * else lives in `server.ts` so it can be imported by a test without stdio being
 * seized at import time.
 *
 * stdio contract: stdout belongs to the MCP wire. Diagnostics go to stderr only.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { API_URL } from './api.js';
import { createServer } from './server.js';

serveStdio(createServer, {
  onerror: (err) => console.error('[devdigest-mcp]', err.message),
});

console.error(`[devdigest-mcp] ready on stdio · API ${API_URL}`);
