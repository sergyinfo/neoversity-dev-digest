/**
 * Thin HTTP client for the DevDigest API (`server/`, :3001 by default).
 *
 * This package deliberately owns NO database access and NO business logic — it
 * is a protocol adapter. Everything it knows about DevDigest it learns over the
 * same REST API the web client uses, so the module boundaries in `server/src`
 * (services reached only through their routes) stay intact.
 *
 * NOTE (stdio): nothing here may ever write to stdout — stdout is the MCP wire.
 * Diagnostics go to stderr via `console.error`.
 */

export const API_URL = (process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001').replace(
  /\/+$/,
  '',
);

/** Per-request timeout. A review run is slow, so it gets its own longer budget. */
const DEFAULT_TIMEOUT_MS = Number(process.env.DEVDIGEST_API_TIMEOUT_MS ?? 30_000);
export const REVIEW_TIMEOUT_MS = Number(process.env.DEVDIGEST_REVIEW_TIMEOUT_MS ?? 120_000);

/**
 * One wall-clock budget shared by a multi-call sequence.
 *
 * `run_review` is not a single request: it warms the diff, starts the run, then
 * polls until the run is terminal. Giving each hop its own timeout would let the
 * sequence run for a multiple of the cap, so the budget is created once and every
 * hop is handed what is left of it.
 */
export class Deadline {
  private readonly endsAt: number;

  constructor(budgetMs: number) {
    this.endsAt = Date.now() + budgetMs;
  }

  /** Milliseconds left, never negative. */
  remaining(): number {
    return Math.max(0, this.endsAt - Date.now());
  }

  expired(): boolean {
    return this.remaining() === 0;
  }

  /** What a single hop may spend: the smaller of its own limit and what is left. */
  forHop(hopMs: number = DEFAULT_TIMEOUT_MS): number {
    return Math.max(1, Math.min(hopMs, this.remaining()));
  }
}

/**
 * An API failure the model can act on. `message` is written for the agent, not
 * for a log file — per Anthropic's tool guidance an error should say what to do
 * next, not just what went wrong.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${API_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ApiError(
        `DevDigest API did not answer within ${Math.round(timeoutMs / 1000)}s (${method} ${path}).`,
      );
    }
    throw new ApiError(
      `Cannot reach the DevDigest API at ${API_URL} (${cause}). ` +
        'Start it with `cd server && pnpm dev`, or set DEVDIGEST_API_URL to where it runs.',
    );
  }

  if (!res.ok) {
    // The API returns a structured envelope: { error: { code, message, details } }.
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = (await res.json()) as { error?: { code?: string; message?: string } };
      if (parsed?.error?.message) detail = `${parsed.error.message} (${parsed.error.code ?? res.status})`;
    } catch {
      /* non-JSON body — keep the status line */
    }
    throw new ApiError(`DevDigest API rejected ${method} ${path}: ${detail}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string, timeoutMs?: number): Promise<T> =>
  request<T>(path, timeoutMs !== undefined ? { timeoutMs } : {});

export const apiPost = <T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    ...(body !== undefined ? { body } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
