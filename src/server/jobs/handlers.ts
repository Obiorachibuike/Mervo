import { and, eq, lte, sql } from "drizzle-orm";
import { memberships, subscriptions, tenants } from "@/server/db/schema";
import type { Db } from "@/server/db";
import { refreshInsights } from "@/server/ai/insights";
import { runDueAutomations } from "@/server/services/automation";
import { recalculateSegments } from "@/server/services/crm";
import { requeueFailed } from "./queue";

type Handler = (db: Db, payload: Record<string, unknown>, tenantId: string | null) => Promise<unknown>;

const allTenantIds = async (db: Db) => (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);

export const HANDLERS: Record<string, Handler> = {
  "generate-insights": async (db, _payload, tenantId) => {
    const ids = tenantId ? [tenantId] : await allTenantIds(db);
    const results = [];
    for (const id of ids) results.push({ tenantId: id, ...(await refreshInsights(db, id)) });
    return { tenants: results.length };
  },
  "run-automations": async (db) => {
    const results = await runDueAutomations(db);
    return { rulesRun: results.length, results };
  },
  "refresh-customer-segments": async (db, _payload, tenantId) => {
    const ids = tenantId ? [tenantId] : await allTenantIds(db);
    let updated = 0;
    for (const id of ids) updated += (await recalculateSegments(db, id)).updated;
    return { updated };
  },
  "expire-trials": async (db) => {
    const expired = await db
      .select({ tenantId: subscriptions.tenantId })
      .from(subscriptions)
      .where(and(eq(subscriptions.status, "trialing"), lte(subscriptions.trialEndsAt, new Date())));
    for (const row of expired) {
      await db.update(subscriptions).set({ status: "expired", updatedAt: new Date() }).where(eq(subscriptions.tenantId, row.tenantId));
      await db.update(tenants).set({ status: "suspended", suspendedReason: "Trial expired", updatedAt: new Date() }).where(eq(tenants.id, row.tenantId));
    }
    return { expired: expired.length };
  },
  "daily-digest": async (db, _payload, tenantId) => {
    const ids = tenantId ? [tenantId] : await allTenantIds(db);
    let processed = 0;
    for (const id of ids) {
      await refreshInsights(db, id);
      processed++;
    }
    return { processed };
  },
  "retry-failed-webhooks": async (db) => ({ requeued: await requeueFailed(db) }),
};

export async function processJob(db: Db, job: { name: string; payload: Record<string, unknown>; tenantId: string | null }) {
  const handler = HANDLERS[job.name];
  if (!handler) throw new Error(`No handler for job ${job.name}`);
  return handler(db, job.payload, job.tenantId);
}

export async function seedScheduledJobs(db: Db) {
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(sql`job_queue` as never);
  void count;
  return { ok: true };
}

export { memberships };
