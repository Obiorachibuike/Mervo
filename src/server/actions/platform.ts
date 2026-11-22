"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { aiProviders, tenants, supportTickets, subscriptions } from "@/server/db/schema";
import { platformCtx, failure } from "./ctx";
import { upsertPlan, type PlanLimits } from "@/server/services/subscriptions";
import { upsertModel, upsertProvider } from "@/server/ai/providers";
import { enqueue, requeueFailed } from "@/server/jobs/queue";
import { ValidationError } from "@/server/lib/validation";

export async function setTenantStatusAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const tenantId = String(formData.get("tenantId"));
    const status = String(formData.get("status")) as "active" | "suspended" | "cancelled" | "trialing";
    const reason = String(formData.get("reason") ?? "");
    if (!["active", "suspended", "cancelled", "trialing"].includes(status)) throw new ValidationError("Unknown status");
    await ctx.db.update(tenants).set({ status, suspendedReason: status === "suspended" ? reason || "Suspended by MERVO" : null, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    if (status === "suspended") await ctx.db.update(subscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(subscriptions.tenantId, tenantId));
    if (status === "active") await ctx.db.update(subscriptions).set({ status: "active", updatedAt: new Date() }).where(eq(subscriptions.tenantId, tenantId));
    await ctx.audit({ action: "platform.tenant_status", entity: "tenant", entityId: tenantId, severity: status === "suspended" ? "critical" : "info", metadata: { status, reason } });
    revalidatePath("/admin/tenants");
    return { ok: true, message: `Workspace ${status}` };
  } catch (error) {
    return failure(error);
  }
}

export async function savePlanAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const code = String(formData.get("code") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    if (!code || !name) throw new ValidationError("Plan code and name are required");
    const limits: PlanLimits = {
      branches: Number(formData.get("branches") ?? 1),
      users: Number(formData.get("users") ?? 3),
      products: Number(formData.get("products") ?? 200),
      terminals: Number(formData.get("terminals") ?? 1),
      aiTokens: Number(formData.get("aiTokens") ?? 50000),
      automations: Number(formData.get("automations") ?? 0),
    };
    await upsertPlan(ctx.db, {
      code,
      name,
      description: String(formData.get("description") ?? "") || null,
      priceMonthly: String(formData.get("priceMonthly") ?? "0"),
      priceYearly: String(formData.get("priceYearly") ?? "0"),
      currency: String(formData.get("currency") ?? "NGN"),
      trialDays: Number(formData.get("trialDays") ?? 14),
      limits,
      features: String(formData.get("features") ?? "").split("\n").map((f) => f.trim()).filter(Boolean),
      isActive: formData.get("isActive") !== "false",
      sortOrder: Number(formData.get("sortOrder") ?? 0),
    });
    await ctx.audit({ action: "platform.plan_saved", entity: "plan", entityId: code, severity: "warning", metadata: { code, limits } });
    revalidatePath("/admin/plans");
    revalidatePath("/pricing");
    return { ok: true, message: `Plan ${code} saved` };
  } catch (error) {
    return failure(error);
  }
}

export async function saveProviderAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const key = String(formData.get("key") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "custom") as "agnes" | "openai" | "huggingface" | "anthropic" | "custom";
    if (!key || !name) throw new ValidationError("Provider key and name are required");
    const apiKey = String(formData.get("apiKey") ?? "");
    const provider = await upsertProvider(ctx.db, {
      key,
      name,
      kind,
      baseUrl: String(formData.get("baseUrl") ?? "") || null,
      apiKey: apiKey || null,
      isEnabled: formData.get("isEnabled") !== "false",
      priority: Number(formData.get("priority") ?? 100),
      monthlyBudget: String(formData.get("monthlyBudget") ?? "0"),
    });
    const modelId = String(formData.get("modelId") ?? "").trim();
    if (modelId) {
      await upsertModel(ctx.db, {
        providerKey: key,
        label: String(formData.get("modelLabel") ?? modelId),
        modelId,
        task: (String(formData.get("task") ?? "chat") as "chat" | "analysis" | "forecast"),
        maxTokens: Number(formData.get("maxTokens") ?? 2048),
        inputCostPer1k: String(formData.get("inputCostPer1k") ?? "0"),
        outputCostPer1k: String(formData.get("outputCostPer1k") ?? "0"),
        isDefault: formData.get("isDefault") === "on",
        isFallback: formData.get("isFallback") === "on",
      });
    }
    await ctx.audit({ action: "platform.provider_saved", entity: "ai_provider", entityId: provider.id, severity: "warning", metadata: { key, kind, keyRotated: Boolean(apiKey) } });
    revalidatePath("/admin/ai");
    return { ok: true, message: `${name} saved${apiKey ? " with a new encrypted key" : ""}` };
  } catch (error) {
    return failure(error);
  }
}

export async function toggleProviderAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const providerId = String(formData.get("providerId"));
    const isEnabled = formData.get("isEnabled") === "true";
    await ctx.db.update(aiProviders).set({ isEnabled, status: isEnabled ? "healthy" : "disabled", updatedAt: new Date() }).where(eq(aiProviders.id, providerId));
    await ctx.audit({ action: "platform.provider_toggle", entity: "ai_provider", entityId: providerId, severity: "warning", metadata: { isEnabled } });
    revalidatePath("/admin/ai");
    return { ok: true, message: isEnabled ? "Provider enabled" : "Provider disabled" };
  } catch (error) {
    return failure(error);
  }
}

export async function addModelAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const providerKey = String(formData.get("providerKey"));
    const modelId = String(formData.get("modelId") ?? "").trim();
    if (!modelId) throw new ValidationError("Model id is required");
    await upsertModel(ctx.db, {
      providerKey,
      label: String(formData.get("label") ?? modelId),
      modelId,
      task: (String(formData.get("task") ?? "chat") as "chat" | "analysis" | "forecast"),
      maxTokens: Number(formData.get("maxTokens") ?? 2048),
      inputCostPer1k: String(formData.get("inputCostPer1k") ?? "0"),
      outputCostPer1k: String(formData.get("outputCostPer1k") ?? "0"),
      isDefault: formData.get("isDefault") === "on",
      isFallback: formData.get("isFallback") === "on",
    });
    await ctx.audit({ action: "platform.model_added", entity: "ai_model", entityId: modelId, metadata: { providerKey } });
    revalidatePath("/admin/ai");
    return { ok: true, message: `${modelId} registered` };
  } catch (error) {
    return failure(error);
  }
}

export async function retryJobsAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const count = await requeueFailed(ctx.db);
    await ctx.audit({ action: "platform.jobs_requeued", entity: "job_queue", metadata: { count } });
    revalidatePath("/admin/jobs");
    return { ok: true, message: `${count} job(s) requeued` };
  } catch (error) {
    return failure(error);
  }
}

export async function enqueueJobAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const name = String(formData.get("name")) as "generate-insights" | "run-automations" | "refresh-customer-segments" | "expire-trials" | "daily-digest" | "retry-failed-webhooks";
    const tenantId = String(formData.get("tenantId") ?? "") || null;
    await enqueue(ctx.db, { name, tenantId });
    await ctx.audit({ action: "platform.job_enqueued", entity: "job_queue", metadata: { name, tenantId } });
    revalidatePath("/admin/jobs");
    return { ok: true, message: `${name} queued` };
  } catch (error) {
    return failure(error);
  }
}

export async function resolveTicketAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await platformCtx();
    const id = String(formData.get("ticketId"));
    const status = String(formData.get("status")) as "open" | "pending" | "resolved" | "closed";
    await ctx.db.update(supportTickets).set({ status, updatedAt: new Date() }).where(eq(supportTickets.id, id));
    revalidatePath("/admin/support");
    return { ok: true, message: `Ticket ${status}` };
  } catch (error) {
    return failure(error);
  }
}
