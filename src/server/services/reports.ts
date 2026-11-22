import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  branches,
  customers,
  expenses,
  payments,
  products,
  saleItems,
  sales,
  stockMovements,
  users,
} from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { add, fromMinor, money, multiply, sub, sum, toMinor } from "@/server/lib/money";
import { fromQty, toQty } from "@/server/lib/money";
import { profitAndLoss, receivables, payables } from "./finance";
import { inventoryValuation, lowStockItems, recommendRestock, salesVelocity } from "./inventory";

export type Range = { from: Date; to: Date };
export const rangeFromDays = (days: number): Range => {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  return { from, to };
};
export const todayRange = (): Range => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return { from, to: new Date() };
};

export async function salesSummary(db: DbLike, tenantId: string, range: Range, branchId?: string) {
  const conditions = [
    eq(sales.tenantId, tenantId),
    gte(sales.createdAt, range.from),
    lte(sales.createdAt, range.to),
    sql`${sales.status} in ('completed','partially_refunded','refunded')`,
  ];
  if (branchId) conditions.push(eq(sales.branchId, branchId));

  const [agg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      gross: sql<string>`coalesce(sum(${sales.total}), 0)::text`,
      subtotal: sql<string>`coalesce(sum(${sales.subtotal}), 0)::text`,
      discount: sql<string>`coalesce(sum(${sales.discountTotal}), 0)::text`,
      tax: sql<string>`coalesce(sum(${sales.taxTotal}), 0)::text`,
      cost: sql<string>`coalesce(sum(${sales.costTotal}), 0)::text`,
      outstanding: sql<string>`coalesce(sum(${sales.balanceDue}), 0)::text`,
      units: sql<string>`coalesce(sum((select sum(quantity) from sale_items si where si.sale_id = ${sales.id})), 0)::text`,
    })
    .from(sales)
    .where(and(...conditions));

  const netRevenue = sub(money(agg?.subtotal ?? "0"), money(agg?.discount ?? "0"));
  const grossProfit = sub(netRevenue, money(agg?.cost ?? "0"));
  const count = agg?.count ?? 0;
  return {
    count,
    gross: money(agg?.gross ?? "0"),
    netRevenue,
    discount: money(agg?.discount ?? "0"),
    tax: money(agg?.tax ?? "0"),
    costOfGoods: money(agg?.cost ?? "0"),
    grossProfit,
    margin: Number(netRevenue) ? Math.round((Number(grossProfit) / Number(netRevenue)) * 1000) / 10 : 0,
    averageBasket: count ? (Number(agg?.gross ?? 0) / count).toFixed(2) : "0.00",
    outstanding: money(agg?.outstanding ?? "0"),
    unitsSold: fromQty(toQty(agg?.units ?? "0")),
    range,
    basis: "actual" as const,
  };
}

export async function salesByDay(db: DbLike, tenantId: string, range: Range, branchId?: string) {
  const conditions = [eq(sales.tenantId, tenantId), gte(sales.createdAt, range.from), lte(sales.createdAt, range.to), eq(sales.status, "completed")];
  if (branchId) conditions.push(eq(sales.branchId, branchId));
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${sales.createdAt}), 'YYYY-MM-DD')`,
      total: sql<string>`coalesce(sum(${sales.total}), 0)::text`,
      cost: sql<string>`coalesce(sum(${sales.costTotal}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${sales.createdAt})`)
    .orderBy(sql`date_trunc('day', ${sales.createdAt})`);
  return rows.map((r) => ({ day: r.day, total: money(r.total), profit: sub(money(r.total), money(r.cost)), count: r.count }));
}

export async function salesByPaymentMethod(db: DbLike, tenantId: string, range: Range) {
  const rows = await db
    .select({ method: payments.method, total: sql<string>`coalesce(sum(${payments.amount}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), gte(payments.createdAt, range.from), lte(payments.createdAt, range.to)))
    .groupBy(payments.method);
  return rows.map((r) => ({ method: r.method, total: money(r.total), count: r.count }));
}

export async function topProducts(db: DbLike, tenantId: string, range: Range, limit = 8) {
  const rows = await db
    .select({
      productId: saleItems.productId,
      name: saleItems.name,
      units: sql<string>`coalesce(sum(${saleItems.quantity}), 0)::text`,
      revenue: sql<string>`coalesce(sum(${saleItems.lineTotal}), 0)::text`,
      cost: sql<string>`coalesce(sum(${saleItems.unitCost} * ${saleItems.quantity}), 0)::text`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(eq(saleItems.tenantId, tenantId), gte(sales.createdAt, range.from), lte(sales.createdAt, range.to), eq(sales.status, "completed")))
    .groupBy(saleItems.productId, saleItems.name)
    .orderBy(desc(sql`sum(${saleItems.quantity})`))
    .limit(limit);
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    units: fromQty(toQty(r.units)),
    revenue: money(r.revenue),
    profit: sub(money(r.revenue), money(r.cost)),
    marginPercent: Number(r.revenue) ? Math.round((Number(sub(money(r.revenue), money(r.cost))) / Number(r.revenue)) * 1000) / 10 : 0,
  }));
}

export async function branchPerformance(db: DbLike, tenantId: string, range: Range) {
  const branchRows = await db.select().from(branches).where(eq(branches.tenantId, tenantId));
  const out = [];
  for (const branch of branchRows) {
    const summary = await salesSummary(db, tenantId, range, branch.id);
    out.push({
      branchId: branch.id,
      name: branch.name,
      type: branch.type,
      isActive: branch.isActive,
      gross: summary.gross,
      netRevenue: summary.netRevenue,
      grossProfit: summary.grossProfit,
      count: summary.count,
      averageBasket: summary.averageBasket,
      margin: summary.margin,
    });
  }
  return out.sort((a, b) => Number(b.gross) - Number(a.gross));
}

export async function expenseSummary(db: DbLike, tenantId: string, range: Range) {
  const [agg] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), gte(expenses.date, range.from), lte(expenses.date, range.to)));
  const byCategory = await db
    .select({ description: expenses.description, total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text` })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), gte(expenses.date, range.from), lte(expenses.date, range.to)))
    .groupBy(expenses.description)
    .orderBy(desc(sql`sum(${expenses.amount})`))
    .limit(10);
  return {
    total: money(agg?.total ?? "0"),
    count: agg?.count ?? 0,
    byCategory: byCategory.map((c) => ({ label: c.description, total: money(c.total) })),
  };
}

export async function customerInsights(db: DbLike, tenantId: string) {
  const rows = await db.select().from(customers).where(eq(customers.tenantId, tenantId));
  const now = Date.now();
  const atRisk = rows.filter((c) => c.lastPurchaseAt && now - c.lastPurchaseAt.getTime() > 30 * 86400000 && now - c.lastPurchaseAt.getTime() <= 90 * 86400000);
  const inactive = rows.filter((c) => !c.lastPurchaseAt || now - c.lastPurchaseAt.getTime() > 90 * 86400000);
  const loyal = rows.filter((c) => c.orderCount >= 5);
  const totalSpent = sum(rows.map((c) => c.totalSpent));
  const top = [...rows].sort((a, b) => Number(b.totalSpent) - Number(a.totalSpent)).slice(0, 8);
  return {
    totalCustomers: rows.length,
    active: rows.length - atRisk.length - inactive.length,
    atRisk: atRisk.length,
    inactive: inactive.length,
    loyal: loyal.length,
    totalSpent,
    averageLifetimeValue: rows.length ? (Number(totalSpent) / rows.length).toFixed(2) : "0.00",
    creditOutstanding: sum(rows.map((c) => c.balanceOwed)),
    topCustomers: top.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      totalSpent: c.totalSpent,
      orders: c.orderCount,
      lastPurchaseAt: c.lastPurchaseAt,
      segment: c.segment,
    })),
    atRiskCustomers: atRisk.slice(0, 10).map((c) => ({ id: c.id, name: c.name, phone: c.phone, lastPurchaseAt: c.lastPurchaseAt, totalSpent: c.totalSpent })),
    inactiveCustomers: inactive.slice(0, 10).map((c) => ({ id: c.id, name: c.name, phone: c.phone, lastPurchaseAt: c.lastPurchaseAt })),
  };
}

/**
 * Sales forecast: ordinary least squares trend on daily revenue plus a weekday
 * seasonal index. Deterministic, explainable, and explicitly an estimate.
 */
export function forecastFromSeries(series: { day: string; total: string }[], horizonDays = 30) {
  const values = series.map((s) => Number(s.total));
  const n = values.length;
  if (n < 3) {
    return { horizonDays, points: [] as { day: string; amount: string }[], expectedTotal: "0.00", confidence: "low" as const, method: "insufficient-history" };
  }
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (values[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const fitted = xs.map((x) => intercept + slope * x);
  const ssRes = values.reduce((acc, v, i) => acc + (v - fitted[i]!) ** 2, 0);
  const ssTot = values.reduce((acc, v) => acc + (v - meanY) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  // weekday seasonality from history
  const weekdayTotals = new Array(7).fill(0);
  const weekdayCounts = new Array(7).fill(0);
  series.forEach((s, i) => {
    const dow = new Date(`${s.day}T00:00:00Z`).getUTCDay();
    weekdayTotals[dow] += values[i]!;
    weekdayCounts[dow] += 1;
  });
  const overallMean = meanY || 1;
  const seasonal = weekdayTotals.map((t, i) => (weekdayCounts[i] ? t / weekdayCounts[i] / overallMean : 1));

  const points: { day: string; amount: string }[] = [];
  let total = 0;
  for (let h = 1; h <= horizonDays; h++) {
    const date = new Date();
    date.setDate(date.getDate() + h);
    const trend = Math.max(0, intercept + slope * (n - 1 + h));
    const dow = date.getDay();
    const amount = trend * (seasonal[dow] || 1);
    total += amount;
    points.push({ day: date.toISOString().slice(0, 10), amount: money(amount.toFixed(2)) });
  }
  return {
    horizonDays,
    points,
    expectedTotal: money(total.toFixed(2)),
    dailyAverage: money((total / horizonDays).toFixed(2)),
    confidence: (r2 > 0.6 ? "high" : r2 > 0.3 ? "medium" : "low") as "high" | "medium" | "low",
    r2: Math.round(r2 * 100) / 100,
    trend: slope > 0 ? ("growing" as const) : slope < 0 ? ("declining" as const) : ("flat" as const),
    method: "ols+weekday-seasonality" as const,
    isEstimate: true as const,
  };
}

export async function businessSnapshot(db: DbLike, tenantId: string, branchId?: string) {
  const today = todayRange();
  const days30 = rangeFromDays(30);
  const [todaySummary, monthSummary, pnl, lowStock, valuation, methods, top, receivable, payable] = await Promise.all([
    salesSummary(db, tenantId, today, branchId),
    salesSummary(db, tenantId, days30, branchId),
    profitAndLoss(db, tenantId, days30),
    branchId ? lowStockItems(db, tenantId, branchId) : Promise.resolve([]),
    inventoryValuation(db, tenantId),
    salesByPaymentMethod(db, tenantId, days30),
    topProducts(db, tenantId, days30, 5),
    receivables(db, tenantId),
    payables(db, tenantId),
  ]);
  return {
    today: todaySummary,
    last30Days: monthSummary,
    profit: { grossProfit: pnl.grossProfit, netProfit: pnl.netProfit, expenses: pnl.expenses, margins: pnl.margins, revenue: pnl.revenue },
    lowStockCount: lowStock.length,
    lowStock: lowStock.slice(0, 6),
    inventoryValue: sum(valuation.map((v) => v.value)),
    paymentMethods: methods,
    topProducts: top,
    receivables: receivable,
    payables: payable,
  };
}

export async function generateBusinessReport(db: DbLike, tenantId: string, days = 30) {
  const range = rangeFromDays(days);
  const [summary, pnl, top, branchRows, exp, customersInfo, restock, velocity] = await Promise.all([
    salesSummary(db, tenantId, range),
    profitAndLoss(db, tenantId, range),
    topProducts(db, tenantId, range, 5),
    branchPerformance(db, tenantId, range),
    expenseSummary(db, tenantId, range),
    customerInsights(db, tenantId),
    recommendRestock(db, tenantId, (await db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1))[0]?.id ?? "").catch(() => []),
    salesVelocity(db, tenantId, days),
  ]);
  const dailyRevenue = await salesByDay(db, tenantId, range);
  const forecast = forecastFromSeries(dailyRevenue, 30);
  return {
    generatedAt: new Date(),
    range,
    headline: `Revenue of ${summary.gross} across ${summary.count} sales in the last ${days} days, with gross profit of ${summary.grossProfit} (${summary.margin}% margin) and net profit of ${pnl.netProfit}.`,
    summary,
    profit: pnl,
    topProducts: top,
    branches: branchRows,
    expenses: exp,
    customers: customersInfo,
    restock: restock.slice(0, 8),
    velocity: velocity.slice(0, 5),
    forecast,
    reconciliation: {
      revenueVsGrossProfit: `Revenue ${pnl.revenue} ≠ gross profit ${pnl.grossProfit} ≠ net profit ${pnl.netProfit}.`,
      ledgerBalanced: pnl.lines.length > 0,
    },
  };
}

export async function activityFeed(db: DbLike, tenantId: string, limit = 8) {
  const movementRows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      createdAt: stockMovements.createdAt,
      qty: stockMovements.quantityDelta,
      productName: products.name,
    })
    .from(stockMovements)
    .leftJoin(products, eq(products.id, stockMovements.productId))
    .where(eq(stockMovements.tenantId, tenantId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
  const saleRows = await db
    .select({ id: sales.id, number: sales.number, total: sales.total, createdAt: sales.createdAt, cashier: users.name })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.createdBy))
    .where(eq(sales.tenantId, tenantId))
    .orderBy(desc(sales.createdAt))
    .limit(limit);
  return { movements: movementRows, sales: saleRows };
}

export { multiply, add, fromMinor, toMinor };
