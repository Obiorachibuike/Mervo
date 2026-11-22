import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { loadAuthContext, requireSuperAdmin, SESSION_COOKIE } from "@/server/auth/session-core";
import { tenants, users, sales } from "@/server/db/schema";
import { platformBillingStats } from "@/server/services/subscriptions";
import { queueStats } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";

/** Machine-readable platform snapshot for the super-admin console and monitoring. */
export async function GET() {
  try {
    const jar = await cookies();
    const auth = await loadAuthContext(jar.get(SESSION_COOKIE)?.value);
    requireSuperAdmin(auth);
    const db = await getDb();
    const [tenantCount] = await db.select({ count: sql<number>`count(*)::int` }).from(tenants);
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [gmv] = await db.select({ total: sql<string>`coalesce(sum(total), 0)::text` }).from(sales);
    const [billing, jobs] = await Promise.all([platformBillingStats(db), queueStats(db)]);
    return NextResponse.json({
      ok: true,
      data: { tenants: tenantCount?.count ?? 0, users: userCount?.count ?? 0, gmv: gmv?.total ?? "0", billing, jobs },
    });
  } catch (error) {
    const status = error instanceof Error && error.name === "AuthError" ? 401 : 403;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Forbidden" }, { status });
  }
}
