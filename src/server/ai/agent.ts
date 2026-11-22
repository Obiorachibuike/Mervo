import { and, desc, eq } from "drizzle-orm";
import { aiConversations, aiMessages, branches } from "@/server/db/schema";
import type { Db } from "@/server/db";
import { formatMoney, money } from "@/server/lib/money";
import { adapterFor, checkQuota, computeCost, recordUsage, resolveCandidates } from "./providers";
import { executeTool, TOOL_DEFINITIONS, type ToolContext } from "./tools";
import { AIQuotaExceededError, type ChatMessage } from "./types";

export type AskInput = {
  db: Db;
  tenantId: string;
  userId: string;
  businessName: string;
  currency: string;
  permissions: string[];
  branchId?: string | null;
  question: string;
  conversationId?: string | null;
  history?: { role: "user" | "assistant"; content: string }[];
};

export type AskResult = {
  answer: string;
  conversationId: string;
  toolCalls: { name: string; args: Record<string, unknown>; result?: unknown }[];
  provider: string | null;
  model: string | null;
  mode: "llm" | "deterministic";
  isEstimate: boolean;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  quota: { used: number; limit: number; allowed: boolean };
  latencyMs: number;
  notice?: string;
};

const SYSTEM_PROMPT = (input: { businessName: string; currency: string; today: string; branch?: string }) => `You are MERVO, the AI business analyst inside a point-of-sale and business management platform.
Business: ${input.businessName}. Reporting currency: ${input.currency}. Today is ${input.today}${input.branch ? `. Default branch: ${input.branch}` : ""}.

Rules you must never break:
1. Every number you report MUST come from a tool result. Never estimate, invent or approximate financial figures.
2. Clearly separate ACTUAL figures (from get_sales_summary, get_profit_summary, etc.) from ESTIMATES (forecast_sales results).
3. Revenue is not profit: quote gross profit and net profit from get_profit_summary when asked about profit.
4. Format money with the business currency. Be concise, structured and practical; use short markdown sections or bullets.
5. If a tool returns an error or permission denial, say what is missing instead of guessing.
6. Suggest concrete next actions (restock, follow up at-risk customers, cut slow movers) when relevant.
7. You cannot change data. You analyse it and recommend.`;

/** Rough token estimate used only when a provider does not return usage. */
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export async function askMervo(input: AskInput): Promise<AskResult> {
  const started = Date.now();
  const quota = await checkQuota(input.db, input.tenantId);
  const toolCtx: ToolContext = {
    db: input.db,
    tenantId: input.tenantId,
    userId: input.userId,
    permissions: input.permissions,
    currency: input.currency,
  };

  const conversationId = await ensureConversation(input);
  await input.db.insert(aiMessages).values({ tenantId: input.tenantId, conversationId, role: "user", content: input.question });

  const branchRows = await input.db.select({ name: branches.name }).from(branches).where(eq(branches.tenantId, input.tenantId));
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT({
        businessName: input.businessName,
        currency: input.currency,
        today: new Date().toISOString().slice(0, 10),
        branch: branchRows[0]?.name,
      }),
    },
    ...(input.history ?? []).slice(-6).map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: "user", content: input.question },
  ];

  const toolCalls: { name: string; args: Record<string, unknown>; result?: unknown }[] = [];
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let lastError: string | undefined;
  let notice: string | undefined;

  if (!quota.allowed) {
    notice = `Your AI quota of ${quota.limit.toLocaleString()} tokens is exhausted (${quota.used.toLocaleString()} used). Showing MERVO's built-in deterministic analytics instead — upgrade your plan to resume conversational AI.`;
    await recordUsage(input.db, {
      tenantId: input.tenantId,
      userId: input.userId,
      providerKey: "none",
      modelLabel: "deterministic",
      task: "chat",
      promptTokens: 0,
      completionTokens: 0,
      cost: "0.00",
      latencyMs: Date.now() - started,
      status: "quota_blocked",
    });
    const fallback = await deterministicAnswer(toolCtx, input.question);
    toolCalls.push(...fallback.toolCalls);
    await persistAssistant(input.db, input.tenantId, conversationId, fallback.answer, toolCalls, fallback.isEstimate);
    return {
      answer: fallback.answer,
      conversationId,
      toolCalls,
      provider: null,
      model: null,
      mode: "deterministic",
      isEstimate: fallback.isEstimate,
      usage,
      quota,
      latencyMs: Date.now() - started,
      notice,
    };
  }

  const candidates = await resolveCandidates(input.db, "chat");
  const tried: string[] = [];

  for (const candidate of candidates) {
    try {
      const adapter = adapterFor(candidate.providerKind);
      let round = 0;
      let finalContent = "";
      while (round < 4) {
        round++;
        const result = await adapter.complete(candidate.credentials, {
          model: candidate.modelId,
          messages,
          tools: TOOL_DEFINITIONS,
          maxTokens: candidate.maxTokens,
          temperature: Number(candidate.temperature),
        });
        usage = {
          promptTokens: usage.promptTokens + result.usage.promptTokens,
          completionTokens: usage.completionTokens + result.usage.completionTokens,
          totalTokens: usage.totalTokens + result.usage.totalTokens,
        };

        if (result.toolCalls.length) {
          messages.push({ role: "assistant", content: result.content ?? "" });
          for (const call of result.toolCalls) {
            const output = await executeTool(toolCtx, call.name, call.arguments);
            toolCalls.push({ name: call.name, args: call.arguments, result: output });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify(output).slice(0, 12_000),
            });
          }
          continue;
        }
        finalContent = result.content;
        break;
      }

      if (!finalContent) finalContent = "I could not produce an answer from the business data. Please rephrase the question.";

      const cost = computeCost(candidate, usage.promptTokens || estimateTokens(JSON.stringify(messages)), usage.completionTokens || estimateTokens(finalContent));
      if (!usage.totalTokens) usage.totalTokens = (usage.promptTokens = estimateTokens(JSON.stringify(messages))) + (usage.completionTokens = estimateTokens(finalContent));
      await recordUsage(input.db, {
        tenantId: input.tenantId,
        userId: input.userId,
        providerKey: candidate.providerKey,
        modelLabel: candidate.label,
        task: "chat",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cost,
        latencyMs: Date.now() - started,
        status: tried.length ? "fallback" : "success",
      });
      const isEstimate = toolCalls.some((t) => t.name === "forecast_sales");
      await persistAssistant(input.db, input.tenantId, conversationId, finalContent, toolCalls, isEstimate);
      return {
        answer: finalContent,
        conversationId,
        toolCalls,
        provider: candidate.providerName,
        model: candidate.modelId,
        mode: "llm",
        isEstimate,
        usage,
        quota,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      tried.push(candidate.providerName);
      lastError = error instanceof Error ? error.message : "provider error";
      await recordUsage(input.db, {
        tenantId: input.tenantId,
        userId: input.userId,
        providerKey: candidate.providerKey,
        modelLabel: candidate.label,
        task: "chat",
        promptTokens: 0,
        completionTokens: 0,
        cost: "0.00",
        latencyMs: Date.now() - started,
        status: "error",
        error: lastError.slice(0, 500),
      });
    }
  }

  // No provider reachable: MERVO's deterministic analytics still answer the question.
  const fallback = await deterministicAnswer(toolCtx, input.question);
  toolCalls.push(...fallback.toolCalls);
  notice =
    candidates.length === 0
      ? "No AI provider is configured yet. This answer was computed by MERVO's deterministic analytics engine. Add an Agnes AI, OpenAI or Hugging Face key in Super Admin → AI to enable conversational answers."
      : `AI providers failed (${tried.join(", ")}): ${lastError?.slice(0, 160) ?? "unknown error"}. Answered with MERVO's deterministic analytics engine.`;
  await recordUsage(input.db, {
    tenantId: input.tenantId,
    userId: input.userId,
    providerKey: candidates[0]?.providerKey ?? "none",
    modelLabel: "deterministic",
    task: "chat",
    promptTokens: 0,
    completionTokens: 0,
    cost: "0.00",
    latencyMs: Date.now() - started,
    status: "fallback",
    error: lastError,
  });
  await persistAssistant(input.db, input.tenantId, conversationId, fallback.answer, toolCalls, fallback.isEstimate);
  return {
    answer: fallback.answer,
    conversationId,
    toolCalls,
    provider: null,
    model: null,
    mode: "deterministic",
    isEstimate: fallback.isEstimate,
    usage,
    quota,
    latencyMs: Date.now() - started,
    notice,
  };
}

async function ensureConversation(input: AskInput): Promise<string> {
  if (input.conversationId) {
    const [existing] = await input.db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(and(eq(aiConversations.id, input.conversationId), eq(aiConversations.tenantId, input.tenantId)))
      .limit(1);
    if (existing) return existing.id;
  }
  const [created] = await input.db
    .insert(aiConversations)
    .values({ tenantId: input.tenantId, userId: input.userId, title: input.question.slice(0, 80) })
    .returning({ id: aiConversations.id });
  return created!.id;
}

async function persistAssistant(db: Db, tenantId: string, conversationId: string, content: string, toolCalls: AskResult["toolCalls"], isEstimate: boolean) {
  await db.insert(aiMessages).values({
    tenantId,
    conversationId,
    role: "assistant",
    content,
    toolCalls,
    isEstimate,
  });
}

/* ───────────────── deterministic answer engine (no LLM required) ─────────── */

export type DeterministicAnswer = { answer: string; toolCalls: AskResult["toolCalls"]; isEstimate: boolean };

/**
 * Intent router used when no LLM is configured or all providers fail.
 * Every figure still comes from the same authorized tools the LLM uses, so the
 * answers are real business data — just phrased with templates.
 */
export async function deterministicAnswer(ctx: ToolContext, question: string): Promise<DeterministicAnswer> {
  const q = question.toLowerCase();
  const calls: AskResult["toolCalls"] = [];
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await executeTool(ctx, name, args);
    calls.push({ name, args, result });
    // tool results are heterogeneous by design; each caller narrows the fields it uses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as Record<string, any>;
  };
  const c = ctx.currency;
  const f = (v: unknown) => formatMoney(money(String(v ?? "0")), c);
  const has = (words: string[]) => words.some((w) => q.includes(w));
  // read an explicit window out of the question ("last 7 days", "past 3 months")
  const windowDays = (() => {
    const match = q.match(/(?:last|past|recent|previous)\s+(\d{1,3})\s*(day|week|month|year)/);
    if (match) {
      const n = Number(match[1]);
      const unit = match[2]!;
      if (unit.startsWith("day")) return Math.min(365, Math.max(1, n));
      if (unit.startsWith("week")) return Math.min(365, Math.max(1, n * 7));
      if (unit.startsWith("month")) return Math.min(365, Math.max(1, n * 30));
      return Math.min(365, Math.max(1, n * 365));
    }
    if (has(["today"])) return 1;
    if (has(["yesterday"])) return 2;
    if (has(["this week", "last week", "weekly", "week"])) return 7;
    if (has(["this month", "last month", "monthly", "month"])) return 30;
    if (has(["this year", "last year", "yearly", "year"])) return 365;
    return 30;
  })();

  if (has(["forecast", "predict", "next month", "next week", "projection"])) {
    const data = await call("forecast_sales", { horizonDays: has(["week"]) ? 7 : 30 });
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const top = (data.points ?? []).slice(0, 7).map((p: { day: string; amount: string }) => `· ${p.day}: ${f(p.amount)}`).join("\n");
    return {
      answer: `**Forecast (estimate — not actual data)**\n\nProjected revenue for the next ${data.horizonDays} days is **${f(data.expectedTotal)}** (about ${f(data.dailyAverage)}/day).\n\nTrend: ${data.trend} · confidence: ${data.confidence} (R² ${data.r2}) · based on ${data.historyDays} days of history using trend + weekday seasonality.\n\nFirst 7 days:\n${top}\n\nTreat this as a planning estimate, not a guarantee.`,
      toolCalls: calls,
      isEstimate: true,
    };
  }

  if (has(["restock", "reorder", "out of stock", "low stock", "stock out", "what should i buy"])) {
    const data = await call("recommend_restock", {});
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const recs = (data.recommendations ?? []) as { name: string; onHand: string; suggestedQty: string; urgency: string; daysOfCover: number; estimatedCost: string }[];
    if (!recs.length) return { answer: "Nothing needs restocking right now — every tracked product has healthy cover against recent demand.", toolCalls: calls, isEstimate: false };
    const lines = recs.slice(0, 8).map((r) => `· **${r.name}** — ${r.onHand} on hand, ${r.daysOfCover} days cover → order **${r.suggestedQty}** (${r.urgency}, ~${f(r.estimatedCost)})`).join("\n");
    const cost = f(recs.reduce((acc, r) => acc + Number(r.estimatedCost), 0).toFixed(2));
    return { answer: `**Restock recommendations** (from demand velocity and lead time)\n\n${lines}\n\nEstimated purchase cost: **${cost}**.`, toolCalls: calls, isEstimate: false };
  }

  if (has(["profit", "margin", "net income", "make money", "earn"])) {
    const data = await call("get_profit_summary", { days: windowDays });
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    return {
      answer: `**Profit & loss — last ${data.windowDays} day(s) (actual)**\n\n· Revenue: **${f(data.revenue)}**\n· Cost of goods sold: ${f(data.costOfGoodsSold)}\n· Refunds: ${f(data.refunds)}\n· **Gross profit: ${f(data.grossProfit)}** (${data.grossMarginPercent}%)\n· Operating expenses: ${f(data.operatingExpenses)}\n· **Net profit: ${f(data.netProfit)}** (${data.netMarginPercent}%)\n\nRevenue is not profit — ${data.definition}`,
      toolCalls: calls,
      isEstimate: false,
    };
  }

  if (has(["compar", "branch", "locations"]) && has(["branch", "location", "store", "compare"])) {
    const data = await call("get_branch_performance", { days: windowDays });
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const rows = (data.branches ?? []) as { name: string; gross: string; grossProfit: string; count: number; margin: number }[];
    const lines = rows.map((r) => `· **${r.name}** — ${f(r.gross)} from ${r.count} sales, gross profit ${f(r.grossProfit)} (${r.margin}% margin)`).join("\n");
    const best = rows[0];
    return {
      answer: `**Branch comparison — last ${data.windowDays ?? windowDays} days (actual)**\n\n${lines || "No branches have sales yet."}${best ? `\n\nTop performer: **${best.name}**.` : ""}`,
      toolCalls: calls,
      isEstimate: false,
    };
  }

  if (has(["best seller", "top product", "fastest", "selling fast", "popular", "highest margin", "most profitable"])) {
    const data = await call("get_top_products", { days: windowDays, limit: 8 });
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const rows = (data.products ?? []) as { name: string; units: string; revenue: string; profit: string; marginPercent: number }[];
    const lines = rows.map((r, i) => `${i + 1}. **${r.name}** — ${r.units} units, ${f(r.revenue)} revenue, ${f(r.profit)} profit (${r.marginPercent}%)`).join("\n");
    return { answer: `**Top products — last ${windowDays} days (actual)**\n\n${lines || "No sales recorded yet."}`, toolCalls: calls, isEstimate: false };
  }

  if (has(["inactive", "at risk", "churn", "customer", "loyal", "lifetime"])) {
    const data = await call("get_customer_insights");
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const risk = (data.atRiskCustomers ?? []) as { name: string; phone: string | null; totalSpent: string }[];
    return {
      answer: `**Customer analytics (actual)**\n\n· Customers: **${data.totalCustomers}** (${data.loyal} loyal, ${data.atRisk} at risk, ${data.inactive} inactive)\n· Average lifetime value: **${f(data.averageLifetimeValue)}**\n· Credit outstanding: ${f(data.creditOutstanding)}\n\n${risk.length ? `At-risk customers to win back:\n${risk.slice(0, 6).map((r) => `· ${r.name}${r.phone ? ` (${r.phone})` : ""} — ${f(r.totalSpent)} lifetime`).join("\n")}\n\nSuggested action: send a WhatsApp or email win-back offer to these customers (marketing consent is respected).` : "No customers are at risk of churning right now."}`,
      toolCalls: calls,
      isEstimate: false,
    };
  }

  if (has(["supplier", "owe", "payable", "debt", "receivable", "credit"])) {
    const data = await call("get_receivables_payables");
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const suppliers = (data.suppliers ?? []) as { name: string; owed: string }[];
    return {
      answer: `**Credit position (actual)**\n\n· Supplier debt (payables): **${f(data.supplierDebt)}**${suppliers.length ? `\n${suppliers.slice(0, 6).map((s) => `  · ${s.name}: ${f(s.owed)}`).join("\n")}` : ""}\n· Customer credit outstanding (receivables): **${f(data.customerCreditOutstanding)}** across ${data.customerCountWithBalance} customers`,
      toolCalls: calls,
      isEstimate: false,
    };
  }

  if (has(["expense", "spend", "cost"])) {
    const data = await call("get_expense_summary", { days: windowDays });
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const rows = (data.byCategory ?? []) as { label: string; total: string }[];
    return {
      answer: `**Expenses — last ${windowDays} days (actual)**\n\nTotal: **${f(data.total)}** across ${data.count} entries.\n\n${rows.map((r) => `· ${r.label}: ${f(r.total)}`).join("\n")}`,
      toolCalls: calls,
      isEstimate: false,
    };
  }

  if (has(["stock", "inventory", "value"])) {
    const data = await call("get_inventory_status", {});
    if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
    const low = (data.lowStock ?? []) as { name: string; onHand: string }[];
    return {
      answer: `**Inventory status (actual)**\n\n· Stock value at cost: **${f(data.inventoryValue)}**\n· Items at/below reorder point: **${data.lowStockCount}**\n${low.slice(0, 8).map((l) => `  · ${l.name}: ${l.onHand} left`).join("\n")}`,
      toolCalls: calls,
      isEstimate: false,
    };
  }

  // Default: sales snapshot (also covers "how much did I sell")
  const days = windowDays;
  const data = await call("get_sales_summary", { days });
  if (data.error) return { answer: data.error, toolCalls: calls, isEstimate: false };
  return {
    answer: `**Sales — last ${data.windowDays} day(s) (actual)**\n\n· Gross sales: **${f(data.grossSales)}**\n· Net revenue (ex-tax): ${f(data.netRevenue)}\n· Discounts: ${f(data.discounts)}\n· Tax collected: ${f(data.taxCollected)}\n· Transactions: **${data.transactions}**\n· Average basket: ${f(data.averageBasket)}\n· Gross profit: ${f(data.grossProfit)}\n\nAsk me about profit, top products, branches, customers, restocking or a forecast for more detail.`,
    toolCalls: calls,
    isEstimate: false,
  };
}

export async function conversationHistory(db: Db, tenantId: string, userId: string, conversationId: string) {
  return db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.tenantId, tenantId), eq(aiMessages.conversationId, conversationId)))
    .orderBy(aiMessages.createdAt);
}

export async function recentConversations(db: Db, tenantId: string, userId: string) {
  return db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.tenantId, tenantId), eq(aiConversations.userId, userId)))
    .orderBy(desc(aiConversations.createdAt))
    .limit(10);
}

export { AIQuotaExceededError };
