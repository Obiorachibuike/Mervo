import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { rateLimitHits } from "@/server/db/schema";

type Options = { bucket: string; identifier: string; limit: number; windowSeconds: number };

/**
 * Fixed-window rate limiter persisted in Postgres so limits hold across
 * serverless instances. Returns whether the call is allowed plus remaining quota.
 */
export async function rateLimit({ bucket, identifier, limit, windowSeconds }: Options): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}> {
  const db = await getDb();
  const since = new Date(Date.now() - windowSeconds * 1000);
  // opportunistic cleanup (cheap, keeps the table small)
  if (Math.random() < 0.05) {
    await db.delete(rateLimitHits).where(lt(rateLimitHits.createdAt, new Date(Date.now() - 24 * 3600 * 1000)));
  }
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.bucket, bucket), eq(rateLimitHits.identifier, identifier), gte(rateLimitHits.createdAt, since)));

  if (count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  await db.insert(rateLimitHits).values({ bucket, identifier });
  return { allowed: true, remaining: Math.max(0, limit - count - 1), retryAfterSeconds: 0 };
}
