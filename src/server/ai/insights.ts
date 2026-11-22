import { and, desc, eq, gte, sql } from "drizzle-orm";
import { aiInsights, auditLogs, branches, expenses, refunds, sales } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { money, sub } from "@/server/lib/money";
import { lowStockItems, shrinkageSignals } from "@/server/services/inventory";
import { customerInsights, forecastFromSeries, salesByDay, salesSummary } from "@/server/services/reports";

export type Insight = {
  kind: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical" | "success";
  data?: Record<string, unknown>;
};

/**
 * Proactive insight generation. All figures are computed deterministically from
 * the ledger; AI providers are only ever used to narrate, never to invent.
 */
export async function generateInsights(db: DbLike, tenantId: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const branchRows = await db.select().from(branches).where(eq(branches.tenantId, tenantId));
  const main = branchRows[0];

  if (main) {
    const low = await lowStockItems(db, tenantId, main.id);
    if (low.length) {
      insights.push({
        kind: "low_stock",
        title: `${low.length} product${low.length === 1 ? "" : "s"} need restocking`,
        body: low.slice(0, 5).map((l) => `${l.name}: ${l.quantity} left (reorder at ${l.reorderPoint})`).join("\n"),
        severity: low.length > 5 ? "critical" : "warning",
        data: { itemCount: low.length, branchId: main.id },
      });
    }
  }

  const customers = await customerInsights(db, tenantId);
  if (customers.atRisk > 0) {
    insights.push({
      kind: "customer_churn",
      title: `${customers.atRisk} customers are at risk of going inactive`,
      body: `They have not purchased in 30–90 days. Combined lifetime value: ${money(customers.atRiskCustomers.reduce((acc, c) => acc + Number(c.totalSpent), 0).toFixed(2))}. A WhatsApp win-back offer is the highest-ROI action this week.`,
      severity: "warning",
      data: { count: customers.atRisk },
    });
  }

  const shrink = await shrinkageSignals(db, tenantId, 30);
  if (shrink.length) {
    insights.push({
      kind: "shrinkage",
      title: `Unusual inventory adjustments detected on ${shrink.length} product${shrink.length === 1 ? "" : "s"}`,
      body: shrink.slice(0, 5).map((s) => `${s.name}: ${s.adjustmentQty} adjusted vs ${s.soldQty} sold (${Math.round(s.adjustmentRatio * 100)}% ratio)`).join("\n"),
      severity: "critical",
      data: { items: shrink },
    });
  }

  const since7 = new Date(Date.now() - 7 * 86400000);
  const since14 = new Date(Date.now() - 14 * 86400000);
  const thisWeek = await salesSummary(db, tenantId, { from: since7, to: new Date() });
  const lastWeek = await salesSummary(db, tenantId, { from: since14, to: since7 });
  if (Number(lastWeek.gross) > 0) {
    const change = ((Number(thisWeek.gross) - Number(lastWeek.gross)) / Number(lastWeek.gross)) * 100;
    if (change <= -15) {
      insights.push({
        kind: "sales_decline",
        title: `Sales are down ${Math.abs(change).toFixed(0)}% versus last week`,
        body: `This week: ${thisWeek.gross} across ${thisWeek.count} sales. Last week: ${lastWeek.gross} across ${lastWeek.count}. Check stockouts, branch staffing and any drop in returning customers before assuming a market problem.`,
        severity: "warning",
        data: { changePercent: Math.round(change * 10) / 10 },
      });
    } else if (change >= 15) {
      insights.push({
        kind: "sales_growth",
        title: `Sales are up ${change.toFixed(0)}% versus last week`,
        body: `${thisWeek.gross} this week versus ${lastWeek.gross} last week. Protect the momentum: make sure your top sellers are not about to stock out.`,
        severity: "success",
        data: { changePercent: Math.round(change * 10) / 10 },
      });
    }
  }

  const [refundAgg] = await db
    .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(refunds)
    .where(and(eq(refunds.tenantId, tenantId), gte(refunds.createdAt, since7)));
  const refundRate = Number(thisWeek.gross) > 0 ? (Number(refundAgg?.total ?? 0) / Number(thisWeek.gross)) * 100 : 0;
  if (refundRate > 5 && (refundAgg?.count ?? 0) > 0) {
    insights.push({
      kind: "refund_anomaly",
      title: `Refund rate is ${refundRate.toFixed(1)}% this week`,
      body: `${refundAgg?.count} refunds worth ${refundAgg?.total} were processed in the last 7 days. That is above the 5% healthy threshold — review the cashier and product mix involved.`,
      severity: "warning",
      data: { refundRate: Math.round(refundRate * 10) / 10 },
    });
  }

  const [expenseAgg] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text` })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), gte(expenses.date, since7)));
  const expenseVsSales = Number(thisWeek.gross) > 0 ? (Number(expenseAgg?.total ?? 0) / Number(thisWeek.gross)) * 100 : 0;
  if (expenseVsSales > 40) {
    insights.push({
      kind: "expense_ratio",
      title: `Operating expenses are ${expenseVsSales.toFixed(0)}% of weekly sales`,
      body: `Expenses of ${expenseAgg?.total} against ${thisWeek.gross} in sales. Anything above 40% squeezes net profit — review the largest categories.`,
      severity: "warning",
      data: { ratio: Math.round(expenseVsSales) },
    });
  }

  const series = await salesByDay(db, tenantId, { from: new Date(Date.now() - 90 * 86400000), to: new Date() });
  const forecast = forecastFromSeries(series, 30);
  if (forecast.points.length) {
    insights.push({
      kind: "forecast",
      title: `Next 30 days projected at ${forecast.expectedTotal} (estimate)`,
      body: `Trend is ${forecast.trend} with ${forecast.confidence} confidence (R² ${forecast.r2}). This is a statistical estimate from the last ${series.length} days, not a booking.`,
      severity: "info",
      data: { expectedTotal: forecast.expectedTotal, confidence: forecast.confidence, trend: forecast.trend },
    });
  }

  const [receivable] = await db
    .select({ total: sql<string>`coalesce(sum(${sales.balanceDue}), 0)::text` })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), sql`${sales.balanceDue} > 0`));
  if (Number(receivable?.total ?? 0) > 0) {
    insights.push({
      kind: "receivables",
      title: `${money(receivable?.total ?? "0")} in unpaid customer credit`,
      body: `Outstanding balances on credit sales. Chasing the oldest balances improves cash flow without needing new sales.`,
      severity: "info",
      data: { outstanding: money(receivable?.total ?? "0") },
    });
  }

  return insights;
}

/** Persists insights, de-duplicating against the last 12 hours. */
export async function refreshInsights(db: DbLike, tenantId: string) {
  const insights = await generateInsights(db, tenantId);
  const since = new Date(Date.now() - 12 * 3600 * 1000);
  const recent = await db
    .select({ kind: aiInsights.kind })
    .from(aiInsights)
    .where(and(eq(aiInsights.tenantId, tenantId), gte(aiInsights.createdAt, since)));
  const seen = new Set(recent.map((r) => r.kind));
  const fresh = insights.filter((i) => !seen.has(i.kind));
  if (fresh.length) {
    await db.insert(aiInsights).values(
      fresh.map((i) => ({ tenantId, kind: i.kind, title: i.title, body: i.body, severity: i.severity, data: i.data ?? {} })),
    );
  }
  return { generated: fresh.length, insights };
}

export async function listInsights(db: DbLike, tenantId: string, limit = 12) {
  return db
    .select()
    .from(aiInsights)
    .where(eq(aiInsights.tenantId, tenantId))
    .orderBy(desc(aiInsights.createdAt))
    .limit(limit);
}

export async function dismissInsight(db: DbLike, tenantId: string, id: string) {
  await db.update(aiInsights).set({ dismissedAt: new Date() }).where(and(eq(aiInsights.id, id), eq(aiInsights.tenantId, tenantId)));
}

export async function criticalAuditEvents(db: DbLike, tenantId: string, limit = 10) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), sql`${auditLogs.severity} in ('warning','critical')`))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export { sub };
