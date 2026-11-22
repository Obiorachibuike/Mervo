import { and, eq } from "drizzle-orm";
import { branches, suppliers } from "@/server/db/schema";
import type { Db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { formatMoney, money, sum } from "@/server/lib/money";
import { businessSnapshot, branchPerformance, customerInsights, expenseSummary, forecastFromSeries, generateBusinessReport, rangeFromDays, salesByDay, salesSummary, topProducts } from "@/server/services/reports";
import { inventoryValuation, lowStockItems, recommendRestock, salesVelocity, shrinkageSignals, slowMovingProducts } from "@/server/services/inventory";
import { payables, profitAndLoss, receivables } from "@/server/services/finance";
import type { ToolDefinition } from "./types";

export type ToolContext = {
  db: Db;
  tenantId: string;
  userId: string;
  permissions: string[];
  currency: string;
};

export type RegisteredTool = {
  definition: ToolDefinition;
  permission: Parameters<typeof assertPermission>[1];
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

async function resolveBranchId(ctx: ToolContext, branch?: unknown): Promise<string | undefined> {
  const rows = await ctx.db.select({ id: branches.id, name: branches.name, code: branches.code }).from(branches).where(eq(branches.tenantId, ctx.tenantId));
  if (!rows.length) return undefined;
  if (typeof branch === "string" && branch.trim()) {
    const needle = branch.trim().toLowerCase();
    const match = rows.find((r) => r.name.toLowerCase().includes(needle) || r.code.toLowerCase() === needle || r.id === branch);
    if (match) return match.id;
  }
  return rows[0]?.id;
}

const num = (v: unknown, fallback: number, min = 1, max = 365) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const fmt = (amount: string, currency: string) => formatMoney(money(amount), currency);

export const TOOLS: Record<string, RegisteredTool> = {
  get_sales_summary: {
    definition: {
      name: "get_sales_summary",
      description: "Actual sales totals (revenue, discounts, tax, transaction count, average basket) for the business over the last N days.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Look-back window in days (1-365). Use 1 for today." }, branch: { type: "string", description: "Optional branch name" } },
        additionalProperties: false,
      },
    },
    permission: "sales.view",
    run: async (ctx, args) => {
      const days = num(args.days, 30);
      const branchId = await resolveBranchId(ctx, args.branch);
      const summary = await salesSummary(ctx.db, ctx.tenantId, rangeFromDays(days), branchId);
      const series = await salesByDay(ctx.db, ctx.tenantId, rangeFromDays(days), branchId);
      return {
        basis: "actual",
        windowDays: days,
        currency: ctx.currency,
        grossSales: summary.gross,
        netRevenue: summary.netRevenue,
        discounts: summary.discount,
        taxCollected: summary.tax,
        grossProfit: summary.grossProfit,
        transactions: summary.count,
        averageBasket: summary.averageBasket,
        unitsSold: summary.unitsSold,
        outstandingCredit: summary.outstanding,
        dailyTotals: series.slice(-14),
      };
    },
  },
  get_profit_summary: {
    definition: {
      name: "get_profit_summary",
      description: "Actual profit & loss from the double-entry ledger: revenue, COGS, refunds, operating expenses, gross profit, net profit and margins. Revenue is not profit.",
      parameters: { type: "object", properties: { days: { type: "number", description: "Look-back window in days" } }, additionalProperties: false },
    },
    permission: "finance.view",
    run: async (ctx, args) => {
      const days = num(args.days, 30);
      const pnl = await profitAndLoss(ctx.db, ctx.tenantId, rangeFromDays(days));
      return {
        basis: "actual",
        windowDays: days,
        currency: ctx.currency,
        revenue: pnl.revenue,
        costOfGoodsSold: pnl.costOfGoods,
        refunds: pnl.refunds,
        grossProfit: pnl.grossProfit,
        operatingExpenses: pnl.expenses,
        netProfit: pnl.netProfit,
        grossMarginPercent: pnl.margins.gross,
        netMarginPercent: pnl.margins.net,
        taxCollected: pnl.taxCollected,
        definition: "Net profit = revenue − refunds − cost of goods sold − operating expenses.",
      };
    },
  },
  get_inventory_status: {
    definition: {
      name: "get_inventory_status",
      description: "Actual stock on hand, inventory valuation and items at or below reorder point.",
      parameters: { type: "object", properties: { lowOnly: { type: "boolean" }, branch: { type: "string" } }, additionalProperties: false },
    },
    permission: "inventory.view",
    run: async (ctx, args) => {
      const branchId = await resolveBranchId(ctx, args.branch);
      const valuation = await inventoryValuation(ctx.db, ctx.tenantId);
      const low = branchId ? await lowStockItems(ctx.db, ctx.tenantId, branchId) : [];
      return {
        basis: "actual",
        currency: ctx.currency,
        inventoryValue: sum(valuation.map((v) => v.value)),
        byBranch: valuation,
        lowStockCount: low.length,
        lowStock: low.slice(0, 15).map((l) => ({ name: l.name, sku: l.sku, onHand: l.quantity, reorderPoint: l.reorderPoint })),
      };
    },
  },
  get_top_products: {
    definition: {
      name: "get_top_products",
      description: "Best selling products by units and revenue, with actual margin per product.",
      parameters: { type: "object", properties: { days: { type: "number" }, limit: { type: "number" } }, additionalProperties: false },
    },
    permission: "reports.view",
    run: async (ctx, args) => ({
      basis: "actual",
      windowDays: num(args.days, 30),
      currency: ctx.currency,
      products: await topProducts(ctx.db, ctx.tenantId, rangeFromDays(num(args.days, 30)), num(args.limit, 8, 1, 50)),
    }),
  },
  get_customer_insights: {
    definition: {
      name: "get_customer_insights",
      description: "Actual customer analytics: totals, lifetime value, at-risk and inactive customers, credit outstanding.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    permission: "customers.view",
    run: async (ctx) => ({ basis: "actual", currency: ctx.currency, ...(await customerInsights(ctx.db, ctx.tenantId)) }),
  },
  get_branch_performance: {
    definition: {
      name: "get_branch_performance",
      description: "Actual comparison of every branch: sales, profit, basket size and margin.",
      parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    },
    permission: "reports.view",
    run: async (ctx, args) => ({
      basis: "actual",
      windowDays: num(args.days, 30),
      currency: ctx.currency,
      branches: await branchPerformance(ctx.db, ctx.tenantId, rangeFromDays(num(args.days, 30))),
    }),
  },
  get_expense_summary: {
    definition: {
      name: "get_expense_summary",
      description: "Actual operating expenses over a window, grouped by category.",
      parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    },
    permission: "finance.view",
    run: async (ctx, args) => ({ basis: "actual", windowDays: num(args.days, 30), currency: ctx.currency, ...(await expenseSummary(ctx.db, ctx.tenantId, rangeFromDays(num(args.days, 30)))) }),
  },
  forecast_sales: {
    definition: {
      name: "forecast_sales",
      description: "Statistical sales forecast (OLS trend + weekday seasonality) for the next N days. This is an ESTIMATE, not actual data.",
      parameters: { type: "object", properties: { horizonDays: { type: "number", description: "1-180" } }, additionalProperties: false },
    },
    permission: "reports.view",
    run: async (ctx, args) => {
      const series = await salesByDay(ctx.db, ctx.tenantId, rangeFromDays(90));
      const forecast = forecastFromSeries(series, num(args.horizonDays, 30, 1, 180));
      return { basis: "estimate", currency: ctx.currency, historyDays: series.length, ...forecast };
    },
  },
  recommend_restock: {
    definition: {
      name: "recommend_restock",
      description: "Deterministic reorder recommendations from demand velocity, lead time and current stock. Returns quantity, urgency and estimated cost.",
      parameters: { type: "object", properties: { branch: { type: "string" }, leadTimeDays: { type: "number" } }, additionalProperties: false },
    },
    permission: "inventory.view",
    run: async (ctx, args) => {
      const branchId = await resolveBranchId(ctx, args.branch);
      if (!branchId) return { basis: "actual", currency: ctx.currency, recommendations: [] };
      const recs = await recommendRestock(ctx.db, ctx.tenantId, branchId, { leadTimeDays: num(args.leadTimeDays, 7, 1, 60) });
      return { basis: "recommendation", currency: ctx.currency, recommendations: recs.slice(0, 12) };
    },
  },
  generate_business_report: {
    definition: {
      name: "generate_business_report",
      description: "Full business report: sales, profit, top products, branches, expenses, customers, restock needs and a forecast.",
      parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    },
    permission: "reports.view",
    run: async (ctx, args) => {
      const report = await generateBusinessReport(ctx.db, ctx.tenantId, num(args.days, 30));
      return { basis: "actual", currency: ctx.currency, ...report };
    },
  },
  get_receivables_payables: {
    definition: {
      name: "get_receivables_payables",
      description: "Actual customer credit outstanding (receivables) and supplier debt (payables).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    permission: "finance.view",
    run: async (ctx) => {
      const [ar, ap, supplierRows] = await Promise.all([receivables(ctx.db, ctx.tenantId), payables(ctx.db, ctx.tenantId), ctx.db.select().from(suppliers).where(eq(suppliers.tenantId, ctx.tenantId))]);
      return {
        basis: "actual",
        currency: ctx.currency,
        customerCreditOutstanding: ar.total,
        customerCountWithBalance: ar.count,
        supplierDebt: ap.total,
        suppliers: supplierRows.filter((s) => Number(s.balanceOwed) > 0).map((s) => ({ name: s.name, owed: s.balanceOwed })),
      };
    },
  },
  get_slow_movers: {
    definition: {
      name: "get_slow_movers",
      description: "Products that have not sold in the selected window (dead stock) with capital tied up.",
      parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    },
    permission: "inventory.view",
    run: async (ctx, args) => {
      const data = await slowMovingProducts(ctx.db, ctx.tenantId, num(args.days, 30));
      return { basis: "actual", currency: ctx.currency, ...data };
    },
  },
  get_shrinkage_signals: {
    definition: {
      name: "get_shrinkage_signals",
      description: "Stock adjustments and wastage compared to sales, highlighting possible losses or theft.",
      parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    },
    permission: "inventory.view",
    run: async (ctx, args) => ({ basis: "actual", windowDays: num(args.days, 30), ...(await shrinkageSignals(ctx.db, ctx.tenantId, num(args.days, 30))) }),
  },
  get_business_snapshot: {
    definition: {
      name: "get_business_snapshot",
      description: "One-call overview: today's sales, 30-day sales, profit, inventory value, low-stock count, payment mix, receivables and payables.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    permission: "reports.view",
    run: async (ctx) => {
      const branchId = await resolveBranchId(ctx);
      return { basis: "actual", currency: ctx.currency, ...(await businessSnapshot(ctx.db, ctx.tenantId, branchId)) };
    },
  },
  get_sales_velocity: {
    definition: {
      name: "get_sales_velocity",
      description: "Per-product daily sales velocity over a window — the basis for demand and restock decisions.",
      parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    },
    permission: "reports.view",
    run: async (ctx, args) => ({ basis: "actual", windowDays: num(args.days, 30), products: (await salesVelocity(ctx.db, ctx.tenantId, num(args.days, 30))).slice(0, 15) }),
  },
};

export const TOOL_DEFINITIONS: ToolDefinition[] = Object.values(TOOLS).map((t) => t.definition);

/** Runs a tool only after verifying the caller's permission and tenant scope. */
export async function executeTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    assertPermission(ctx.permissions, tool.permission);
  } catch {
    return { error: `You do not have permission to access ${name.replace(/_/g, " ")}.` };
  }
  try {
    return await tool.run(ctx, args);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Tool execution failed" };
  }
}

export async function branchList(db: Db, tenantId: string) {
  return db.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.tenantId, tenantId)));
}

export { fmt };
