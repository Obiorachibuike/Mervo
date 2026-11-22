import { and, asc, desc, eq } from "drizzle-orm";
import { aiModels, aiProviders, aiUsage, tenants } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { decryptSecret, encryptSecret } from "@/server/lib/crypto";
import { add, money, multiply, toMinor } from "@/server/lib/money";
import { AIProviderError, type AIAdapter, type CompletionRequest, type CompletionResult, type ProviderCredentials, type ToolCall } from "./types";

/** OpenAI-compatible chat completions — used by Agnes, OpenAI, Hugging Face router and custom gateways. */
class OpenAICompatibleAdapter implements AIAdapter {
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }

  private endpoint(baseUrl: string): string {
    const clean = baseUrl.replace(/\/+$/, "");
    if (clean.endsWith("/chat/completions")) return clean;
    return `${clean}/chat/completions`;
  }

  async complete(creds: ProviderCredentials, request: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => {
        if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
        if (m.role === "assistant" && m.toolCallId) return { role: "assistant", content: m.content || null, tool_call_id: m.toolCallId };
        return { role: m.role, content: m.content };
      }),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: false,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = "auto";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(this.endpoint(creds.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(creds.apiKey ? { authorization: `Bearer ${creds.apiKey}` } : {}),
          ...(creds.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new AIProviderError(`${this.kind} responded ${res.status}: ${text.slice(0, 300)}`, this.kind, res.status);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const choice = json.choices?.[0];
      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.function.name,
        arguments: safeJson(tc.function.arguments),
      }));
      return {
        content: choice?.message?.content ?? "",
        toolCalls,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
          totalTokens: json.usage?.total_tokens ?? (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
        },
        finishReason: choice?.finish_reason,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async test(creds: ProviderCredentials, model: string) {
    const started = Date.now();
    try {
      const result = await this.complete(creds, {
        model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        maxTokens: 16,
        temperature: 0,
      });
      return { ok: true, latencyMs: Date.now() - started, modelEcho: result.content.slice(0, 40) };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "unknown error" };
    }
  }
}

const adapters: Record<string, AIAdapter> = {
  agnes: new OpenAICompatibleAdapter("agnes"),
  openai: new OpenAICompatibleAdapter("openai"),
  huggingface: new OpenAICompatibleAdapter("huggingface"),
  anthropic: new OpenAICompatibleAdapter("anthropic"),
  custom: new OpenAICompatibleAdapter("custom"),
};

export const adapterFor = (kind: string): AIAdapter => adapters[kind] ?? adapters.custom!;

export const DEFAULT_BASE_URLS: Record<string, string> = {
  agnes: process.env.AGNES_BASE_URL ?? "https://api.agnes.ai/v1",
  openai: "https://api.openai.com/v1",
  huggingface: "https://router.huggingface.co/v1",
  anthropic: "https://api.anthropic.com/v1",
  custom: "",
};

export type CandidateModel = {
  providerId: string;
  providerKey: string;
  providerName: string;
  providerKind: string;
  modelId: string;
  label: string;
  task: string;
  maxTokens: number;
  temperature: string;
  inputCostPer1k: string;
  outputCostPer1k: string;
  isDefault: boolean;
  isFallback: boolean;
  credentials: ProviderCredentials;
  priority: number;
};

function credentialsFor(provider: { kind: string; baseUrl: string | null; apiKeyEncrypted: string | null; config: Record<string, unknown> }): ProviderCredentials {
  const stored = decryptSecret(provider.apiKeyEncrypted);
  const envKey =
    provider.kind === "agnes" ? process.env.AGNES_API_KEY : provider.kind === "openai" ? process.env.OPENAI_API_KEY : provider.kind === "huggingface" ? process.env.HF_TOKEN : undefined;
  const apiKey = (stored && stored.trim()) || (envKey && envKey.trim()) || null;
  const baseUrl = provider.baseUrl || DEFAULT_BASE_URLS[provider.kind] || "";
  const extraHeaders: Record<string, string> = {};
  if (provider.kind === "huggingface" && apiKey) extraHeaders["x-use-cache"] = "true";
  return { apiKey, baseUrl, extraHeaders };
}

/**
 * Ordered model candidates: explicit default → fallbacks → remaining enabled
 * models, each only if the provider is enabled, within budget and credentialed.
 */
export async function resolveCandidates(db: DbLike, task: "chat" | "analysis" | "forecast" | "summarise" = "chat"): Promise<CandidateModel[]> {
  const rows = await db
    .select({ model: aiModels, provider: aiProviders })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(and(eq(aiModels.isEnabled, true), eq(aiProviders.isEnabled, true)))
    .orderBy(desc(aiModels.isDefault), desc(aiModels.isFallback), asc(aiProviders.priority));

  const candidates: CandidateModel[] = [];
  for (const { model, provider } of rows) {
    if (model.task !== task && model.task !== "chat" && task !== "chat") continue;
    const credentials = credentialsFor(provider);
    if (!credentials.apiKey && provider.kind !== "custom") continue;
    if (!credentials.baseUrl) continue;
    if (toMinor(provider.monthlyBudget) > 0n && toMinor(provider.spendThisMonth) >= toMinor(provider.monthlyBudget)) continue;
    candidates.push({
      providerId: provider.id,
      providerKey: provider.key,
      providerName: provider.name,
      providerKind: provider.kind,
      modelId: model.modelId,
      label: model.label,
      task: model.task,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      inputCostPer1k: model.inputCostPer1k,
      outputCostPer1k: model.outputCostPer1k,
      isDefault: model.isDefault,
      isFallback: model.isFallback,
      credentials,
      priority: provider.priority,
    });
  }
  return candidates;
}

export function computeCost(candidate: Pick<CandidateModel, "inputCostPer1k" | "outputCostPer1k">, promptTokens: number, completionTokens: number): string {
  const input = multiply(candidate.inputCostPer1k, (promptTokens / 1000).toFixed(4));
  const output = multiply(candidate.outputCostPer1k, (completionTokens / 1000).toFixed(4));
  return add(input, output);
}

export async function recordUsage(
  db: DbLike,
  input: {
    tenantId: string | null;
    userId?: string | null;
    providerKey: string;
    modelLabel: string;
    task: string;
    promptTokens: number;
    completionTokens: number;
    cost: string;
    latencyMs: number;
    status: "success" | "error" | "fallback" | "quota_blocked";
    error?: string;
  },
) {
  await db.insert(aiUsage).values({
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    providerKey: input.providerKey,
    modelLabel: input.modelLabel,
    task: input.task,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    cost: money(input.cost),
    latencyMs: input.latencyMs,
    status: input.status,
    error: input.error ?? null,
  });
  const total = input.promptTokens + input.completionTokens;
  if (input.tenantId && total > 0) {
    await db
      .update(tenants)
      .set({ aiTokensUsed: (await currentTokenUsage(db, input.tenantId)) + total })
      .where(eq(tenants.id, input.tenantId));
  }
  if (toMinor(input.cost) > 0n) {
    const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.key, input.providerKey)).limit(1);
    if (provider) {
      await db
        .update(aiProviders)
        .set({ spendThisMonth: add(provider.spendThisMonth, input.cost), updatedAt: new Date() })
        .where(eq(aiProviders.id, provider.id));
    }
  }
}

async function currentTokenUsage(db: DbLike, tenantId: string): Promise<number> {
  const [row] = await db.select({ used: tenants.aiTokensUsed }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row?.used ?? 0;
}

export async function checkQuota(db: DbLike, tenantId: string): Promise<{ used: number; limit: number; allowed: boolean }> {
  const [row] = await db.select({ used: tenants.aiTokensUsed, limit: tenants.aiTokensLimit }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const used = row?.used ?? 0;
  const limit = row?.limit ?? 0;
  return { used, limit, allowed: limit <= 0 ? false : used < limit };
}

export async function testProviderConnection(
  db: DbLike,
  providerId: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string; model?: string }> {
  const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
  if (!provider) return { ok: false, latencyMs: 0, error: "Provider not found" };
  const [model] = await db.select().from(aiModels).where(eq(aiModels.providerId, provider.id)).limit(1);
  const credentials = credentialsFor(provider);
  if (!credentials.apiKey && provider.kind !== "custom") {
    return { ok: false, latencyMs: 0, error: "No API key configured for this provider" };
  }
  const result = await adapterFor(provider.kind).test(credentials, model?.modelId ?? "");
  await db
    .update(aiProviders)
    .set({ status: result.ok ? "healthy" : "degraded", lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiProviders.id, provider.id));
  return { ...result, model: model?.modelId };
}

export async function upsertProvider(
  db: DbLike,
  input: {
    key: string;
    name: string;
    kind: "agnes" | "openai" | "huggingface" | "anthropic" | "custom";
    baseUrl?: string | null;
    apiKey?: string | null;
    isEnabled?: boolean;
    priority?: number;
    monthlyBudget?: string;
  },
) {
  const values = {
    key: input.key,
    name: input.name,
    kind: input.kind,
    baseUrl: input.baseUrl ?? DEFAULT_BASE_URLS[input.kind] ?? null,
    isEnabled: input.isEnabled ?? true,
    priority: input.priority ?? 100,
    monthlyBudget: money(input.monthlyBudget ?? "0"),
    ...(input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== ""
      ? { apiKeyEncrypted: encryptSecret(input.apiKey), status: "healthy" as const }
      : {}),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(aiProviders)
    .values({ ...values, key: input.key, name: input.name, kind: input.kind, baseUrl: values.baseUrl ?? "" })
    .onConflictDoUpdate({ target: aiProviders.key, set: values })
    .returning();
  return row!;
}

export async function upsertModel(
  db: DbLike,
  input: {
    providerKey: string;
    label: string;
    modelId: string;
    task?: "chat" | "analysis" | "forecast" | "embedding" | "vision" | "summarise";
    maxTokens?: number;
    temperature?: string;
    inputCostPer1k?: string;
    outputCostPer1k?: string;
    isDefault?: boolean;
    isFallback?: boolean;
    isEnabled?: boolean;
  },
) {
  const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.key, input.providerKey)).limit(1);
  if (!provider) throw new AIProviderError(`Unknown provider ${input.providerKey}`);
  if (input.isDefault) {
    await db.update(aiModels).set({ isDefault: false }).where(eq(aiModels.isDefault, true));
  }
  const [row] = await db
    .insert(aiModels)
    .values({
      providerId: provider.id,
      label: input.label,
      modelId: input.modelId,
      task: input.task ?? "chat",
      maxTokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? "0.30",
      inputCostPer1k: money(input.inputCostPer1k ?? "0"),
      outputCostPer1k: money(input.outputCostPer1k ?? "0"),
      isDefault: input.isDefault ?? false,
      isFallback: input.isFallback ?? false,
      isEnabled: input.isEnabled ?? true,
    })
    .onConflictDoUpdate({
      target: [aiModels.providerId, aiModels.modelId],
      set: {
        label: input.label,
        task: input.task ?? "chat",
        maxTokens: input.maxTokens ?? 2048,
        temperature: input.temperature ?? "0.30",
        inputCostPer1k: money(input.inputCostPer1k ?? "0"),
        outputCostPer1k: money(input.outputCostPer1k ?? "0"),
        isDefault: input.isDefault ?? false,
        isFallback: input.isFallback ?? false,
        isEnabled: input.isEnabled ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type { CompletionRequest, CompletionResult };
