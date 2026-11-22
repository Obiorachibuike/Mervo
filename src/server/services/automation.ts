import { and, desc, eq, gte, sql } from "drizzle-orm";
import { automationRules, automationRuns, aiInsights, customers, expenses, products, sales, stockLevels, branches } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { money, sum } from "@/server/lib/money";
import { lowStockItems, recommendRestock } from "./inventory";
import { customerInsights } from "./reports";

export type AutomationRule = typeof automationRules.$inferSelect;

export const AUTOMATION_TEMPLATES = [
  {
    key: "low-stock-alert",
    name: "Notify me when inventory is low",
    triggerType: "schedule" as const,
    triggerConfig: { cron: "daily", at: "08:00" },
    actionType: "notify" as const,
    actionConfig: { channel: "dashboard", severity: "warning", message: "Items have fallen to or below their reorder point." },
  },
  {
    key: "daily-sales-summary",
    name: "Send daily sales summary",
    triggerType: "schedule" as const,
    triggerConfig: { cron: "daily", at: "21:00" },
    actionType: "report" as const,
    actionConfig: { report: "daily-sales", channel: "dashboard" },
  },
  {
    key: "expense-threshold",
    name: "Alert when expenses exceed threshold",
    triggerType: "threshold" as const,
    triggerConfig: { metric: "daily_expenses", amount: "50000" },
    actionType: "notify" as const,
    actionConfig: { channel: "dashboard", severity: "critical" },
  },
  {
    key: "suspicious-refunds",
    name: "Notify managers about suspicious refunds",
    triggerType: "event" as const,
    triggerConfig: { event: "sale.refund" },
    actionType: "notify" as const,
    actionConfig: { channel: "dashboard", severity: "critical" },
  },
  {
    key: "weekly-report",
    name: "Generate weekly business reports",
    triggerType: "schedule" as const,
    triggerConfig: { cron: "weekly", day: "monday" },
    actionType: "report" as const,
    actionConfig: { report: "weekly-brief", channel: "dashboard" },
  },
  {
    key: "reorder-recommendation",
    name: "Recommend products to reorder",
    triggerType: "schedule" as const,
    triggerConfig: { cron: "daily", at: "07:00" },
    actionType: "restock_suggestion" as const,
    actionConfig: { channel: "dashboard" },
  },
  {
    key: "birthday-promo",
    name: "Send customer birthday promotions",
    triggerType: "schedule" as const,
    triggerConfig: { cron: "daily", at: "09:00" },
    actionType: "email" as const,
    actionConfig: { channel: "email", template: "birthday" },
  },
];

export async function listRules(db: DbLike, tenantId: string) {
  return db.select().from(automationRules).where(eq(automationRules.tenantId, tenantId)).orderBy(desc(automationRules.createdAt));
}

export async function createRule(
  db: DbLike,
  tenantId: string,
  input: {
    name: string;
    triggerType: "schedule" | "event" | "threshold";
    triggerConfig: Record<string, unknown>;
    actionType: "notify" | "email" | "report" | "restock_suggestion" | "create_po" | "webhook";
    actionConfig: Record<string, unknown>;
    conditions?: Record<string, unknown>[];
    requiresApproval?: boolean;
    createdBy: string;
  },
) {
  const [row] = await db
    .insert(automationRules)
    .values({
      tenantId,
      name: input.name,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      actionType: input.actionType,
      actionConfig: input.actionConfig,
      conditions: input.conditions ?? [],
      requiresApproval: input.requiresApproval ?? false,
      createdBy: input.createdBy,
    })
    .returning();
  return row!;
}

export async function toggleRule(db: DbLike, tenantId: string, id: string, isActive: boolean) {
  const [row] = await db
    .update(automationRules)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, tenantId)))
    .returning();
  return row;
}

/** Executes one rule. Sensitive actions are held for approval instead of firing. */
export async function executeRule(db: DbLike, rule: AutomationRule): Promise<{ status: "success" | "failed" | "skipped" | "awaiting_approval"; output: string }> {
  const tenantId = rule.tenantId;
  try {
    if (rule.requiresApproval && ["create_po", "webhook", "email"].includes(rule.actionType)) {
      return { status: "awaiting_approval", output: `Awaiting owner approval: ${rule.name}` };
    }
    const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1);

    if (rule.actionType === "restock_suggestion") {
      if (!branch) return { status: "skipped", output: "No branch configured" };
      const recs = await recommendRestock(db, tenantId, branch.id);
      const critical = recs.filter((r) => r.urgency === "critical" || r.urgency === "high");
      if (!critical.length) return { status: "skipped", output: "No restock needed today" };
      await db.insert(aiInsights).values({
        tenantId,
        kind: "restock",
        title: `${critical.length} products need restocking`,
        body: critical.slice(0, 6).map((r) => `${r.name}: ${r.onHand} on hand, ${r.daysOfCover} days cover — order ${r.suggestedQty}`).join("\n"),
        severity: "warning",
        data: { ruleId: rule.id, recommendations: critical.slice(0, 12) },
      });
      return { status: "success", output: `Recommended ${critical.length} products for restock` };
    }

    if (rule.actionType === "notify") {
      const config = rule.actionConfig as { severity?: "info" | "warning" | "critical"; message?: string };
      const since = new Date(Date.now() - 86400000);
      let body = config.message ?? "Automation triggered";
      if (rule.triggerType === "threshold") {
        const threshold = String((rule.triggerConfig as { amount?: string }).amount ?? "0");
        const [agg] = await db
          .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text` })
          .from(expenses)
          .where(and(eq(expenses.tenantId, tenantId), gte(expenses.date, since)));
        const total = money(agg?.total ?? "0");
        if (Number(total) < Number(threshold)) return { status: "skipped", output: `Expenses ${total} below threshold ${threshold}` };
        body = `Expenses in the last 24h reached ${total}, above your ${threshold} threshold.`;
      }
      if (rule.triggerType === "event") {
        const [recent] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(sales)
          .where(and(eq(sales.tenantId, tenantId), eq(sales.status, "refunded"), gte(sales.createdAt, since)));
        body = `${recent?.count ?? 0} refunds recorded in the last 24 hours. Review for anomalies.`;
      }
      if (rule.triggerType === "schedule" && (rule.triggerConfig as { cron?: string }).cron === "daily") {
        if (branch) {
          const low = await lowStockItems(db, tenantId, branch.id);
          body = low.length ? `${low.length} items are at or below reorder point: ${low.slice(0, 5).map((l) => l.name).join(", ")}` : "All stock levels are healthy.";
        }
      }
      await db.insert(aiInsights).values({
        tenantId,
        kind: "automation",
        title: rule.name,
        body,
        severity: config.severity ?? "info",
        data: { ruleId: rule.id },
      });
      return { status: "success", output: body };
    }

    if (rule.actionType === "report") {
      const since = new Date(Date.now() - 86400000);
      const [agg] = await db
        .select({ total: sql<string>`coalesce(sum(${sales.total}), 0)::text`, count: sql<number>`count(*)::int` })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), gte(sales.createdAt, since)));
      const body = `Sales in the last 24h: ${money(agg?.total ?? "0")} across ${agg?.count ?? 0} transactions.`;
      await db.insert(aiInsights).values({ tenantId, kind: "report", title: rule.name, body, severity: "info", data: { ruleId: rule.id } });
      return { status: "success", output: body };
    }

    if (rule.actionType === "email") {
      const info = await customerInsights(db, tenantId);
      const consentRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.marketingConsent, true)));
      const body = `Marketing campaign queued for ${consentRows[0]?.count ?? 0} consented customers (${info.atRisk} at risk of churn).`;
      await db.insert(aiInsights).values({ tenantId, kind: "campaign", title: rule.name, body, severity: "info", data: { ruleId: rule.id } });
      return { status: "success", output: body };
    }

    return { status: "skipped", output: `Action ${rule.actionType} is not enabled in this deployment` };
  } catch (error) {
    return { status: "failed", output: error instanceof Error ? error.message : "Automation failed" };
  }
}

export async function runRule(db: DbLike, rule: AutomationRule) {
  const result = await executeRule(db, rule);
  await db.insert(automationRuns).values({
    tenantId: rule.tenantId,
    ruleId: rule.id,
    status: result.status,
    output: result.output,
    finishedAt: new Date(),
  });
  await db
    .update(automationRules)
    .set({ lastRunAt: new Date(), runCount: rule.runCount + 1 })
    .where(eq(automationRules.id, rule.id));
  return result;
}

export async function runDueAutomations(db: DbLike) {
  const rules = await db.select().from(automationRules).where(eq(automationRules.isActive, true));
  const results = [];
  for (const rule of rules) {
    const lastRun = rule.lastRunAt?.getTime() ?? 0;
    const cron = (rule.triggerConfig as { cron?: string }).cron;
    const minInterval = cron === "weekly" ? 6.5 * 86400000 : 20 * 3600 * 1000;
    if (Date.now() - lastRun < minInterval) continue;
    results.push({ ruleId: rule.id, name: rule.name, ...(await runRule(db, rule)) });
  }
  return results;
}

export async function runHistory(db: DbLike, tenantId: string) {
  return db
    .select({ run: automationRuns, ruleName: automationRules.name })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
    .where(eq(automationRuns.tenantId, tenantId))
    .orderBy(desc(automationRuns.startedAt))
    .limit(40);
}

export { sum, products, stockLevels };
