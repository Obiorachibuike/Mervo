import { and, desc, eq, sql } from "drizzle-orm";
import { billingEvents, branches, memberships, plans, products, subscriptions, tenants, automationRules } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { money } from "@/server/lib/money";

export type PlanLimits = { branches: number; users: number; products: number; terminals: number; aiTokens: number; automations: number };

export class PlanLimitError extends Error {
  constructor(public readonly limitKey: string, public readonly limit: number, public readonly current: number) {
    super(`Your plan allows ${limit} ${limitKey} (currently ${current}). Upgrade to add more.`);
    this.name = "PlanLimitError";
  }
}

export async function listPlans(db: DbLike, includeInactive = false) {
  const rows = await db.select().from(plans).orderBy(plans.sortOrder);
  return includeInactive ? rows : rows.filter((p) => p.isActive);
}

export async function getSubscription(db: DbLike, tenantId: string) {
  const [row] = await db
    .select({ subscription: subscriptions, plan: plans, tenant: tenants })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function usageCounts(db: DbLike, tenantId: string) {
  const [row] = await db
    .select({
      branches: sql<number>`(select count(*)::int from ${branches} b where b.tenant_id = ${tenantId})`,
      users: sql<number>`(select count(*)::int from ${memberships} m where m.tenant_id = ${tenantId})`,
      products: sql<number>`(select count(*)::int from ${products} p where p.tenant_id = ${tenantId})`,
      automations: sql<number>`(select count(*)::int from ${automationRules} a where a.tenant_id = ${tenantId})`,
      aiTokens: sql<number>`(select ai_tokens_used from ${tenants} t where t.id = ${tenantId})`,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return row ?? { branches: 0, users: 0, products: 0, automations: 0, aiTokens: 0 };
}

export async function assertWithinLimit(db: DbLike, tenantId: string, key: "branches" | "users" | "products" | "automations") {
  const sub = await getSubscription(db, tenantId);
  if (!sub) return;
  const usage = await usageCounts(db, tenantId);
  const limit = (sub.plan.limits as PlanLimits)[key];
  const current = usage[key];
  if (limit >= 0 && current >= limit) throw new PlanLimitError(key, limit, current);
}

export async function changePlan(db: DbLike, tenantId: string, planCode: string, interval: "monthly" | "yearly" = "monthly") {
  const [plan] = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
  if (!plan) throw new Error("Plan not found");
  const [current] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  if (!current) throw new Error("No subscription for this business");
  const periodEnd = new Date(Date.now() + (interval === "yearly" ? 365 : 30) * 86400000);
  const [updated] = await db
    .update(subscriptions)
    .set({ planId: plan.id, interval, status: "active", currentPeriodStart: new Date(), currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(eq(subscriptions.id, current.id))
    .returning();
  await db
    .update(tenants)
    .set({ status: "active", aiTokensLimit: plan.limits.aiTokens, trialEndsAt: null, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
  return { subscription: updated!, plan, previousPlanId: current.planId };
}

export async function cancelSubscription(db: DbLike, tenantId: string, immediate = false) {
  const [current] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  if (!current) throw new Error("No subscription for this business");
  const [updated] = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: !immediate, status: immediate ? "cancelled" : current.status, cancelledAt: immediate ? new Date() : null, updatedAt: new Date() })
    .where(eq(subscriptions.id, current.id))
    .returning();
  if (immediate) await db.update(tenants).set({ status: "cancelled" }).where(eq(tenants.id, tenantId));
  return updated!;
}

export async function resumeSubscription(db: DbLike, tenantId: string) {
  const [updated] = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, cancelledAt: null, status: "active", updatedAt: new Date() })
    .where(eq(subscriptions.tenantId, tenantId))
    .returning();
  await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, tenantId));
  return updated;
}

export async function upsertPlan(
  db: DbLike,
  input: { code: string; name: string; description?: string | null; priceMonthly: string; priceYearly: string; currency?: string; trialDays?: number; limits: PlanLimits; features: string[]; isActive?: boolean; sortOrder?: number },
) {
  const [row] = await db
    .insert(plans)
    .values({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      priceMonthly: money(input.priceMonthly),
      priceYearly: money(input.priceYearly),
      currency: input.currency ?? "NGN",
      trialDays: input.trialDays ?? 14,
      limits: input.limits,
      features: input.features,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .onConflictDoUpdate({
      target: plans.code,
      set: {
        name: input.name,
        description: input.description ?? null,
        priceMonthly: money(input.priceMonthly),
        priceYearly: money(input.priceYearly),
        currency: input.currency ?? "NGN",
        trialDays: input.trialDays ?? 14,
        limits: input.limits,
        features: input.features,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

/** Idempotent billing webhook application (unique gateway+event id). */
export async function applyBillingEvent(
  db: DbLike,
  input: { gateway: string; eventId: string; type: string; tenantId?: string | null; planCode?: string | null; amount: string; payload: Record<string, unknown> },
) {
  const [existing] = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(and(eq(billingEvents.gateway, input.gateway), eq(billingEvents.eventId, input.eventId)))
    .limit(1);
  if (existing) return { duplicate: true as const };

  await db.insert(billingEvents).values({
    tenantId: input.tenantId ?? null,
    gateway: input.gateway,
    eventId: input.eventId,
    type: input.type,
    amount: money(input.amount),
    payload: input.payload,
  });

  const success = /success|charge\.succeeded|payment|subscription\.created|subscription\.renewed/i.test(input.type);
  if (input.tenantId && input.planCode && success) {
    await changePlan(db, input.tenantId, input.planCode);
  }
  return { duplicate: false as const, applied: Boolean(input.tenantId && input.planCode && success) };
}

export async function billingHistory(db: DbLike, tenantId: string) {
  return db.select().from(billingEvents).where(eq(billingEvents.tenantId, tenantId)).orderBy(desc(billingEvents.createdAt)).limit(50);
}

export async function platformBillingStats(db: DbLike) {
  const [agg] = await db
    .select({
      active: sql<number>`sum(case when status = 'active' then 1 else 0 end)::int`,
      trialing: sql<number>`sum(case when status = 'trialing' then 1 else 0 end)::int`,
      cancelled: sql<number>`sum(case when status = 'cancelled' then 1 else 0 end)::int`,
      pastDue: sql<number>`sum(case when status = 'past_due' then 1 else 0 end)::int`,
    })
    .from(subscriptions);
  const mrrRows = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${subscriptions.interval} = 'yearly' then ${plans.priceYearly} / 12 else ${plans.priceMonthly} end), 0)::text`,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.status, "active"));
  return {
    active: agg?.active ?? 0,
    trialing: agg?.trialing ?? 0,
    cancelled: agg?.cancelled ?? 0,
    pastDue: agg?.pastDue ?? 0,
    mrr: money(mrrRows[0]?.total ?? "0"),
  };
}
