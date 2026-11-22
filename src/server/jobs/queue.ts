import { and, eq, lte, sql } from "drizzle-orm";
import { jobQueue } from "@/server/db/schema";
import type { Db, DbLike } from "@/server/db";

export type JobName =
  | "generate-insights"
  | "run-automations"
  | "refresh-customer-segments"
  | "expire-trials"
  | "daily-digest"
  | "retry-failed-webhooks";

export async function enqueue(
  db: DbLike,
  input: { name: JobName; payload?: Record<string, unknown>; tenantId?: string | null; runAt?: Date; queue?: string; maxAttempts?: number },
) {
  const [row] = await db
    .insert(jobQueue)
    .values({
      name: input.name,
      queue: input.queue ?? "default",
      payload: input.payload ?? {},
      tenantId: input.tenantId ?? null,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 3,
    })
    .returning({ id: jobQueue.id });
  return row!.id;
}

/**
 * Claims the next due job atomically with SKIP LOCKED so multiple workers (or
 * several serverless invocations) never process the same job twice.
 */
export async function claimNext(db: Db, workerId: string) {
  const rows = await db.execute(sql`
    UPDATE job_queue
       SET status = 'active', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM job_queue
        WHERE status = 'queued' AND run_at <= now()
        ORDER BY run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, name, payload, tenant_id, attempts, max_attempts
  `);
  const list = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  const row = list[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name) as JobName,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    attempts: Number(row.attempts ?? 1),
    maxAttempts: Number(row.max_attempts ?? 3),
  };
}

export async function completeJob(db: Db, id: string) {
  await db.update(jobQueue).set({ status: "completed", finishedAt: new Date() }).where(eq(jobQueue.id, id));
}

export async function failJob(db: Db, id: string, error: string, attempts: number, maxAttempts: number) {
  const retryIn = Math.min(300, 15 * 2 ** attempts);
  if (attempts >= maxAttempts) {
    await db.update(jobQueue).set({ status: "failed", lastError: error.slice(0, 2000), finishedAt: new Date() }).where(eq(jobQueue.id, id));
    return { retried: false };
  }
  await db
    .update(jobQueue)
    .set({ status: "queued", lastError: error.slice(0, 2000), runAt: new Date(Date.now() + retryIn * 1000), lockedAt: null, lockedBy: null })
    .where(eq(jobQueue.id, id));
  return { retried: true, retryInSeconds: retryIn };
}

export async function queueStats(db: DbLike) {
  const rows = await db
    .select({ status: jobQueue.status, count: sql<number>`count(*)::int` })
    .from(jobQueue)
    .groupBy(jobQueue.status);
  const recentFailures = await db
    .select({ id: jobQueue.id, name: jobQueue.name, lastError: jobQueue.lastError, createdAt: jobQueue.createdAt })
    .from(jobQueue)
    .where(eq(jobQueue.status, "failed"))
    .limit(10);
  return {
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.count])) as Record<string, number>,
    recentFailures,
  };
}

export async function requeueFailed(db: DbLike) {
  const rows = await db.select({ id: jobQueue.id }).from(jobQueue).where(and(eq(jobQueue.status, "failed"), lte(jobQueue.attempts, 10)));
  for (const row of rows) {
    await db.update(jobQueue).set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null }).where(eq(jobQueue.id, row.id));
  }
  return rows.length;
}
