import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { boot, createWorkspace, addMember } from "./harness";
import { tenants } from "@/server/db/schema";
import { askMervo, deterministicAnswer } from "@/server/ai/agent";
import { checkQuota, resolveCandidates, upsertProvider, upsertModel, computeCost } from "@/server/ai/providers";
import { executeTool } from "@/server/ai/tools";
import { createSale } from "@/server/services/sales";

const key = () => `ai-${Math.random().toString(36).slice(2)}`;

async function withSales(db: Awaited<ReturnType<typeof boot>>, label: string) {
  const ws = await createWorkspace(db, label);
  for (let i = 0; i < 3; i++) {
    await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "2.000" }],
      payments: [{ method: "cash", amount: "5000.00" }],
      idempotencyKey: key(),
    });
  }
  return ws;
}

describe("AI business intelligence", () => {
  it("answers with real, computed figures when no LLM is configured", async () => {
    const db = await boot();
    const ws = await withSales(db, "AI Co");
    const result = await askMervo({
      db,
      tenantId: ws.tenantId,
      userId: ws.ownerId,
      businessName: "AI Co",
      currency: "NGN",
      permissions: ["*"],
      question: "How much did I sell today?",
    });
    expect(result.mode).toBe("deterministic");
    expect(result.answer).toContain("₦6,450.00"); // 3 × 2150
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.toolCalls[0]!.name).toBe("get_sales_summary");
    expect(result.quota.allowed).toBe(true);
  });

  it("distinguishes estimates from actuals in forecasts", async () => {
    const db = await boot();
    const ws = await withSales(db, "AI Forecast Co");
    const result = await askMervo({
      db,
      tenantId: ws.tenantId,
      userId: ws.ownerId,
      businessName: "AI Forecast Co",
      currency: "NGN",
      permissions: ["*"],
      question: "Forecast next month's sales",
    });
    expect(result.isEstimate).toBe(true);
    expect(result.answer.toLowerCase()).toContain("estimate");
  });

  it("routes common business questions to the right tool", async () => {
    const db = await boot();
    const ws = await withSales(db, "AI Router Co");
    const ctx = { db, tenantId: ws.tenantId, userId: ws.ownerId, permissions: ["*"], currency: "NGN" };
    const cases: [string, string][] = [
      ["What should I restock?", "recommend_restock"],
      ["Which products are selling fastest?", "get_top_products"],
      ["Compare my branches", "get_branch_performance"],
      ["How much do I owe suppliers?", "get_receivables_payables"],
      ["Which customers have become inactive?", "get_customer_insights"],
      ["What was my net profit yesterday?", "get_profit_summary"],
    ];
    for (const [question, expectedTool] of cases) {
      const answer = await deterministicAnswer(ctx, question);
      expect(answer.toolCalls[0]?.name, question).toBe(expectedTool);
      expect(answer.answer).not.toContain("undefined");
    }
  });

  it("refuses tools the caller has no permission for", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "AI Perm Co");
    const cashier = await addMember(db, ws.tenantId, "cashier");
    const result = (await executeTool(
      { db, tenantId: ws.tenantId, userId: cashier.userId, permissions: cashier.permissions, currency: "NGN" },
      "get_expense_summary",
      { days: 30 },
    )) as { error?: string };
    expect(result.error).toMatch(/permission/i);
  });

  it("enforces the tenant AI token quota", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "AI Quota Co");
    await db.update(tenants).set({ aiTokensLimit: 100, aiTokensUsed: 100 }).where(eq(tenants.id, ws.tenantId));
    const quota = await checkQuota(db, ws.tenantId);
    expect(quota.allowed).toBe(false);
    const result = await askMervo({
      db,
      tenantId: ws.tenantId,
      userId: ws.ownerId,
      businessName: "AI Quota Co",
      currency: "NGN",
      permissions: ["*"],
      question: "How much did I sell today?",
    });
    expect(result.mode).toBe("deterministic");
    expect(result.notice).toMatch(/quota/i);
    const blocked = (await db.execute(sql`select count(*)::int as n from ai_usage where tenant_id = ${ws.tenantId} and status = 'quota_blocked'`)).rows as { n: number }[];
    expect(blocked[0]!.n).toBe(1);
  });

  it("never treats unconfigured providers as live", async () => {
    const db = await boot();
    const candidates = await resolveCandidates(db, "chat");
    // no API keys exist in the test environment → no candidate may be returned
    expect(candidates.every((c) => c.credentials.apiKey)).toBe(true);
    expect(candidates.length).toBe(0);
  });

  it("computes provider cost from per-1k token pricing", () => {
    const cost = computeCost({ inputCostPer1k: "0.40", outputCostPer1k: "1.20" }, 2000, 1000);
    expect(cost).toBe("2.00"); // 0.80 in + 1.20 out
  });

  it("stores provider credentials encrypted, never in plain text", async () => {
    const db = await boot();
    const provider = await upsertProvider(db, { key: `test-provider-${Date.now()}`, name: "Test Provider", kind: "openai", apiKey: "sk-test-abcdef123456", priority: 99 });
    expect(provider.apiKeyEncrypted).toContain("v1.");
    const model = await upsertModel(db, { providerKey: provider.key, label: "Test Model", modelId: "test-model", isDefault: false });
    expect(model.providerId).toBe(provider.id);
    const leaked = (await db.execute(sql`select count(*)::int as n from ai_providers where api_key_encrypted like '%sk-test-abcdef123456%'`)).rows as { n: number }[];
    expect(leaked[0]!.n).toBe(0);
  });

  it("records usage, latency and model per call", async () => {
    const db = await boot();
    const ws = await withSales(db, "AI Usage Co");
    await askMervo({
      db,
      tenantId: ws.tenantId,
      userId: ws.ownerId,
      businessName: "AI Usage Co",
      currency: "NGN",
      permissions: ["*"],
      question: "How much did I sell today?",
    });
    const [row] = await db.execute(sql`select provider_key, model_label, latency_ms, status from ai_usage where tenant_id = ${ws.tenantId} order by created_at desc limit 1`).then((r) => r.rows as { provider_key: string; model_label: string; latency_ms: number; status: string }[]);
    expect(row!.latency_ms).toBeGreaterThanOrEqual(0);
    expect(row!.status).toBe("fallback");
  });
});
