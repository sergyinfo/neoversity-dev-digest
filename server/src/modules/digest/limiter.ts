import type { FastifyRequest } from 'fastify';

/**
 * Token-bucket limiter for the public digest endpoint.
 *
 * The digest is served without auth, so it needs its own ceiling independent of
 * the workspace-scoped routes.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Identify the caller. Behind the load balancer the real IP is forwarded. */
export function bucketKey(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip;
}

/**
 * Consume one token for this caller.
 *
 * Returns how many requests are left in the window, or `null` when the caller
 * is over the limit and should be refused.
 */
export function consume(key: string): number | null {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return MAX_REQUESTS - 1;
  }

  existing.count = existing.count + 1;
  if (existing.count > MAX_REQUESTS) return null;

  return MAX_REQUESTS - existing.count;
}

/** Seconds until this caller's window rolls over, for the 429 body. */
export function retryAfter(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  return Math.ceil((bucket.resetAt - Date.now()) / 1000);
}
