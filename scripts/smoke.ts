import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { tenants, users, memberships, roles } from "@/server/db/schema";
import { businessSnapshot, rangeFromDays, generateBusinessReport } from "@/server/services/reports";
import { trialBalance, balanceSheet, profitAndLoss } from "@/server/services/finance";
import { askMervo } from "@/server/ai/agent";

async function main() {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("no tenant");
  const [owner] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, "owner@mervo.app"));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(sql`sales` as never) as unknown as [{ total: number }];
  const [{ n: items }] = await db.execute(sql`select count(*)::int as n from sale_items`).then(r => r.rows as [{ n: number }]);

  const snap = await businessSnapshot(db, tenant.id);
  console.log("sales:", total, "items:", items);
  console.log("today gross:", snap.today.gross, "count:", snap.today.count);
  console.log("30d gross:", snap.last30Days.gross, "profit:", snap.profit.netProfit);
  console.log("inventory value:", snap.inventoryValue, "low stock:", snap.lowStockCount);
  console.log("receivables:", snap.receivables.total, "payables:", snap.payables.total);

  const tb = await trialBalance(db, tenant.id);
  console.log("trial balance balanced:", tb.balanced, tb.debitTotal, tb.creditTotal);
  const bs = await balanceSheet(db, tenant.id);
  console.log("balance sheet balanced:", bs.balanced, "assets:", bs.totalAssets, "L+E:", bs.totalLiabilities, "+", bs.totalEquity);
  const pnl = await profitAndLoss(db, tenant.id, rangeFromDays(30));
  console.log("P&L 30d revenue:", pnl.revenue, "gross:", pnl.grossProfit, "net:", pnl.netProfit, "margins:", pnl.margins);

  const report = await generateBusinessReport(db, tenant.id, 30);
  console.log("forecast:", report.forecast.expectedTotal, report.forecast.confidence, report.forecast.isEstimate);

  const [m] = await db.select().from(memberships).where(eq(memberships.tenantId, tenant.id)).limit(1);
  const [role] = await db.select().from(roles).where(eq(roles.id, m!.roleId));
  const answer = await askMervo({
    db, tenantId: tenant.id, userId: owner!.id, businessName: tenant.name, currency: tenant.currency,
    permissions: ["*"], question: "How much did I sell today and what was my net profit?",
  });
  console.log("\nmode:", answer.mode, "| notice:", answer.notice?.slice(0, 120));
  console.log(answer.answer.slice(0, 700));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
