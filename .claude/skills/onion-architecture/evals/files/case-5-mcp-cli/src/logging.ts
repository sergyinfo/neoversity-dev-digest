type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.MCP_LOG_LEVEL as Level) ?? 'info'];

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  process.stderr.write(`${JSON.stringify({ level, message, ...fields })}\n`);
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => log('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => log('error', m, f),
};
