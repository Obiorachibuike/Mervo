import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { loadAuthContext, requireTenant, SESSION_COOKIE } from "@/server/auth/session-core";
import { assertPermission } from "@/server/auth/permissions";
import { createSaleSchema } from "@/server/lib/validation";
import { createSale } from "@/server/services/sales";
import { handleApiError, jsonError, jsonOk, parseJson } from "@/server/lib/http";

export const dynamic = "force-dynamic";

type SyncItem = { idempotencyKey: string; payload: unknown };
type SyncResult = { idempotencyKey: string; ok: boolean; number?: string; duplicate?: boolean; error?: string };

/**
 * Bulk offline synchronisation. Each entry is processed independently so one bad
 * sale cannot block the rest, and every result is reported back to the terminal.
 */
export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const auth = await loadAuthContext(jar.get(SESSION_COOKIE)?.value);
    const ctx = requireTenant(auth);
    assertPermission(ctx.rawPermissions, "sales.create");

    const body = await parseJson<{ sales?: SyncItem[] }>(request);
    if (!Array.isArray(body.sales) || body.sales.length === 0) return jsonError("No sales to synchronise", 422);
    if (body.sales.length > 100) return jsonError("Synchronise at most 100 sales per request", 422);

    const db = await getDb();
    const results: SyncResult[] = [];
    for (const item of body.sales) {
      const parsed = createSaleSchema.safeParse({ ...(item.payload as object), source: "offline_sync" });
      if (!parsed.success) {
        results.push({ idempotencyKey: item.idempotencyKey, ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        continue;
      }
      try {
        const sale = await createSale(
          { db, tenantId: ctx.tenantId, userId: ctx.user.id, permissions: ctx.rawPermissions },
          {
            ...parsed.data,
            customerId: parsed.data.customerId ?? null,
            notes: parsed.data.notes ?? null,
            source: "offline_sync",
            offlineCreatedAt: parsed.data.offlineCreatedAt ? new Date(parsed.data.offlineCreatedAt) : null,
          },
        );
        results.push({ idempotencyKey: item.idempotencyKey, ok: true, number: sale.number, duplicate: sale.duplicate });
      } catch (error) {
        results.push({ idempotencyKey: item.idempotencyKey, ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    }
    return jsonOk({ results, synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  } catch (error) {
    return handleApiError(error);
  }
}
