import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { tenants } from "@/server/db/schema";
import { loadAuthContext, requireTenant, SESSION_COOKIE } from "@/server/auth/session-core";
import { assertPermission } from "@/server/auth/permissions";
import { askMervo } from "@/server/ai/agent";
import { handleApiError, jsonError, jsonOk, parseJson } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  question: z.string().trim().min(2, "Ask a question").max(1000),
  conversationId: z.string().uuid().optional().nullable(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(6)
    .optional(),
});

export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const auth = await loadAuthContext(jar.get(SESSION_COOKIE)?.value);
    const ctx = requireTenant(auth);
    assertPermission(ctx.rawPermissions, "ai.assistant.use");

    const limit = await rateLimit({ bucket: "ai-chat", identifier: ctx.user.id, limit: 30, windowSeconds: 300 });
    if (!limit.allowed) return jsonError("You are asking faster than the assistant can answer. Please wait a moment.", 429);

    const body = schema.safeParse(await parseJson<unknown>(request));
    if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Invalid request", 422);

    const db = await getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);

    const result = await askMervo({
      db,
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      businessName: tenant?.name ?? "Your business",
      currency: ctx.tenant?.currency ?? "NGN",
      permissions: ctx.rawPermissions,
      branchId: ctx.branchId,
      question: body.data.question,
      conversationId: body.data.conversationId ?? null,
      history: body.data.history,
    });

    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
