import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { IdParams } from '../_shared/schemas.js';
import { bucketKey, consume, retryAfter } from './limiter.js';

/**
 * Public review digest.
 *   GET /digest/:id → a read-only summary of one PR's latest review
 *
 * Unauthenticated by design: the point is a link that can be pasted into a chat
 * without the reader needing a workspace. Rate limited per caller.
 */
export default async function digestRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/digest/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const key = bucketKey(req);

    let remaining: number | null = null;
    try {
      remaining = consume(key);
    } catch (err) {
      req.log.warn({ err }, 'digest limiter unavailable; serving the request');
      remaining = 1;
    }

    if (remaining === null) {
      return reply.status(429).send({ error: 'Too many requests' });
    }
    reply.header('X-RateLimit-Remaining', String(remaining));

    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, req.params.id));
    if (!pr) return reply.status(404).send({ error: 'Not found' });

    const reviews = await container.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.prId, pr.id));
    const latest = reviews[reviews.length - 1];

    const findings = latest
      ? await container.db.select().from(t.findings).where(eq(t.findings.reviewId, latest.id))
      : [];

    return {
      pr: { number: pr.number, title: pr.title, author: pr.author, branch: pr.branch },
      review: latest
        ? { verdict: latest.verdict, summary: latest.summary, score: latest.score }
        : null,
      findings: findings.map((f) => ({
        severity: f.severity,
        category: f.category,
        title: f.title,
        file: f.file,
        line: f.startLine,
        rationale: f.rationale,
      })),
      retry_after: retryAfter(key),
    };
  });
}
