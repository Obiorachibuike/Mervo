import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { plans } from "@/server/db/schema";
import { seedAIProviders, seedDemoTenant, seedPlans, seedPlatformSettings, seedSuperAdmin } from "@/server/db/seed";
import { ensureSystemRoles } from "@/server/services/tenants";

/**
 * Idempotent platform bootstrap: subscription plans, system roles, AI provider
 * registry and the super-admin account. Safe to run on every cold start.
 */
export async function bootstrapPlatform(db: Db) {
  const [{ n } = { n: 0 }] = (await db.execute(sql`select count(*)::int as n from plans`)).rows as { n: number }[];
  if (n === 0) {
    await seedPlans(db);
    await seedPlatformSettings(db);
    await seedAIProviders(db);
    await seedSuperAdmin(db);
  }
  await ensureSystemRoles(db);

  const [{ t } = { t: 0 }] = (await db.execute(sql`select count(*)::int as t from tenants`)).rows as { t: number }[];
  const wantsDemo = process.env.SEED_DEMO !== "0" && (process.env.SEED_DEMO === "1" || !process.env.DATABASE_URL);
  if (t === 0 && wantsDemo) {
    try {
      await seedDemoTenant(db);
      console.log("[mervo] demo workspace seeded (owner@mervo.app / MervoDemo#2025)");
    } catch (error) {
      console.error("[mervo] demo seed failed", error);
    }
  }
  void plans;
  return { bootstrapped: n === 0, tenants: t };
}
