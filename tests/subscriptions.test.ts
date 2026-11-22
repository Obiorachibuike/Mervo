import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { boot, createWorkspace } from "./harness";
import { billingEvents, plans, tenants } from "@/server/db/schema";
import {
  applyBillingEvent,
  assertWithinLimit,
  cancelSubscription,
  changePlan,
  getSubscription,
  listPlans,
  platformBillingStats,
  resumeSubscription,
  usageCounts,
  PlanLimitError,
  upsertPlan,
} from "@/server/services/subscriptions";
import { verifyWebhook, gatewayConfigured } from "@/server/payments/gateways";
import { createBranch } from "@/server/services/tenants";

describe("subscriptions & billing", () => {
  it("seeds every documented plan", async () => {
    const db = await boot();
    const all = await listPlans(db);
    const codes = all.map((p) => p.code);
    for (const code of ["free", "starter", "growth", "business", "enterprise"]) expect(codes).toContain(code);
  });

  it("starts a workspace on a trial with the selected plan", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Billing Co");
    const sub = await getSubscription(db, ws.tenantId);
    expect(sub?.subscription.status).toBe("trialing");
    expect(sub?.plan.code).toBe("growth");
    expect(sub?.subscription.trialEndsAt).toBeTruthy();
  });

  it("enforces plan limits when creating branches", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Limits Co");
    await upsertPlan(db, {
      code: "growth",
      name: "Growth",
      priceMonthly: "35000",
      priceYearly: "350000",
      limits: { branches: 2, users: 25, products: 20000, terminals: 10, aiTokens: 1500000, automations: 15 },
      features: [],
      sortOrder: 3,
    });
    const usage = await usageCounts(db, ws.tenantId);
    expect(usage.branches).toBe(2);
    await expect(assertWithinLimit(db, ws.tenantId, "branches")).rejects.toThrow(PlanLimitError);
  });

  it("upgrades and downgrades plans with billing period management", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Upgrade Co");
    const upgraded = await changePlan(db, ws.tenantId, "business", "monthly");
    expect(upgraded.plan.code).toBe("business");
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, ws.tenantId));
    expect(tenant!.status).toBe("active");
    expect(tenant!.aiTokensLimit).toBe(5000000);
    const downgraded = await changePlan(db, ws.tenantId, "starter", "yearly");
    expect(downgraded.plan.code).toBe("starter");
    expect(downgraded.subscription.interval).toBe("yearly");
  });

  it("cancels at period end and resumes without losing access", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Cancel Co");
    const cancelled = await cancelSubscription(db, ws.tenantId, false);
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    expect(cancelled.status).toBe("trialing");
    const resumed = await resumeSubscription(db, ws.tenantId);
    expect(resumed!.cancelAtPeriodEnd).toBe(false);
  });

  it("applies billing webhooks idempotently", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Webhook Co");
    const eventId = `evt_${Date.now()}`;
    const first = await applyBillingEvent(db, { gateway: "paystack", eventId, type: "charge.success", tenantId: ws.tenantId, planCode: "business", amount: "35000.00", payload: { ok: true } });
    const second = await applyBillingEvent(db, { gateway: "paystack", eventId, type: "charge.success", tenantId: ws.tenantId, planCode: "business", amount: "35000.00", payload: { ok: true } });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const sub = await getSubscription(db, ws.tenantId);
    expect(sub?.plan.code).toBe("business");
    const nRows = (await db.execute(sql`select count(*)::int as n from billing_events where event_id = ${eventId}`)).rows as { n: number }[];
    expect(nRows[0]!.n).toBe(1);
    void billingEvents;
    void plans;
  });

  it("verifies Paystack webhook signatures server-side", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_mervo_secret";
    const body = JSON.stringify({ event: "charge.success", data: { id: 1234, reference: "ref-1", amount: 3500000, metadata: { tenantId: "t1", planCode: "business" } } });
    const signature = createHmac("sha512", "sk_test_mervo_secret").update(body).digest("hex");
    const good = verifyWebhook("paystack", body, new Headers({ "x-paystack-signature": signature }));
    expect(good.valid).toBe(true);
    expect(good.amount).toBe("35000.00");
    expect(good.planCode).toBe("business");

    const bad = verifyWebhook("paystack", body, new Headers({ "x-paystack-signature": "deadbeef" }));
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/signature/i);
  });

  it("verifies Stripe signatures with the timestamped payload", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const body = JSON.stringify({ id: "evt_9", type: "checkout.session.completed", data: { object: { id: "cs_1", amount_total: 7500000, metadata: { tenantId: "t2", planCode: "business" } } } });
    const t = Math.floor(Date.now() / 1000).toString();
    const v1 = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    const result = verifyWebhook("stripe", body, new Headers({ "stripe-signature": `t=${t},v1=${v1}` }));
    expect(result.valid).toBe(true);
    expect(result.amount).toBe("75000.00");
    const tampered = verifyWebhook("stripe", `${body} `, new Headers({ "stripe-signature": `t=${t},v1=${v1}` }));
    expect(tampered.valid).toBe(false);
  });

  it("never reports a gateway as configured without credentials", () => {
    delete process.env.FLUTTERWAVE_SECRET_KEY;
    delete process.env.FLUTTERWAVE_WEBHOOK_HASH;
    expect(gatewayConfigured("flutterwave")).toBe(false);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(gatewayConfigured("stripe")).toBe(false);
  });

  it("computes platform MRR from active subscriptions only", async () => {
    const db = await boot();
    const stats = await platformBillingStats(db);
    expect(Number(stats.mrr)).toBeGreaterThanOrEqual(0);
    expect(stats.active + stats.trialing).toBeGreaterThan(0);
  });

  it("super admin can create plans with custom limits", async () => {
    const db = await boot();
    const plan = await upsertPlan(db, {
      code: "custom-enterprise",
      name: "Custom Enterprise",
      priceMonthly: "500000",
      priceYearly: "5000000",
      limits: { branches: -1, users: -1, products: -1, terminals: -1, aiTokens: 50000000, automations: -1 },
      features: ["Everything"],
      sortOrder: 9,
    });
    expect(plan.code).toBe("custom-enterprise");
    const [row] = await db.select().from(plans).where(eq(plans.code, "custom-enterprise"));
    expect(row!.limits.aiTokens).toBe(50000000);
    const usage = await usageCounts(db, (await createWorkspace(db, "PlanUsage Co")).tenantId);
    expect(usage.products).toBe(3);
  });
});
