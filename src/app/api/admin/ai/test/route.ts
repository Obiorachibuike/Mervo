import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { loadAuthContext, requireSuperAdmin, SESSION_COOKIE } from "@/server/auth/session-core";
import { testProviderConnection } from "@/server/ai/providers";
import { handleApiError, jsonError, jsonOk, parseJson } from "@/server/lib/http";
import { logAudit } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const auth = await loadAuthContext(jar.get(SESSION_COOKIE)?.value);
    const admin = requireSuperAdmin(auth);
    const body = await parseJson<{ providerId?: string }>(request);
    if (!body.providerId) return jsonError("providerId is required", 422);
    const db = await getDb();
    const result = await testProviderConnection(db, body.providerId);
    await logAudit({
      actorId: admin.user.id,
      actorEmail: admin.user.email,
      action: "admin.ai_provider_test",
      entity: "ai_provider",
      entityId: body.providerId,
      severity: result.ok ? "info" : "warning",
      metadata: { ok: result.ok, latencyMs: result.latencyMs, error: result.error },
    });
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
