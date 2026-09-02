import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { toolContext } from './contracts.js';
import { logger } from './logging.js';
import { runReviewTool } from './tools/run-review.js';
import { rerunReviewTool } from './tools/rerun-review.js';
import { listPullsTool } from './tools/list-pulls.js';
import { getFindingsTool } from './tools/get-findings.js';
import { diffSummaryTool } from './tools/diff-summary.js';

const tools = [runReviewTool, rerunReviewTool, listPullsTool, getFindingsTool, diffSummaryTool];

async function main(): Promise<void> {
  const ctx = toolContext(
    process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001',
    process.env.DEVDIGEST_TOKEN ?? '',
    process.env.DEVDIGEST_WORKSPACE ?? ''
  );

  const server = new Server({ name: 'devdigest', version: '1.3.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler('tools/list', async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
  }));

  server.setRequestHandler('tools/call', async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool ${req.params.name}`);
    return tool.handler(ctx, req.params.arguments);
  });

  await server.connect(new StdioServerTransport());
  logger.info('mcp server ready', { tools: tools.length });
}

main().catch((err) => {
  logger.error('fatal', { err: String(err) });
  process.exit(1);
});
