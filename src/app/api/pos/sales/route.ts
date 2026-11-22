import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { loadAuthContext, requireTenant, SESSION_COOKIE } from "@/server/auth/session-core";
import { assertPermission } from "@/server/auth/permissions";
import { createSaleSchema, ValidationError } from "@/server/lib/validation";
import { createSale } from "@/server/services/sales";
import { getClientIp, handleApiError, jsonError, parseJson } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POS sale endpoint. Used by the live terminal and by the offline sync queue.
 * Idempotent by `idempotencyKey`: retries return the original sale.
 */
export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const auth = await loadAuthContext(jar.get(SESSION_COOKIE)?.value);
    const ctx = requireTenant(auth);
    assertPermission(ctx.rawPermissions, "sales.create");

    const limit = await rateLimit({ bucket: "pos-sale", identifier: `${ctx.user.id}:${getClientIp(request)}`, limit: 120, windowSeconds: 60 });
    if (!limit.allowed) return jsonError("Too many transactions in a short period. Slow down briefly.", 429);

    const raw = await parseJson<unknown>(request);
    const parsed = createSaleSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid sale payload");

    const db = await getDb();
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, parsed.data.branchId), eq(branches.tenantId, ctx.tenantId)))
      .limit(1);
    if (!branch) return jsonError("Branch not found in this workspace", 404);

    const result = await createSale(
      { db, tenantId: ctx.tenantId, userId: ctx.user.id, permissions: ctx.rawPermissions },
      {
        branchId: parsed.data.branchId,
        customerId: parsed.data.customerId ?? null,
        items: parsed.data.items,
        payments: parsed.data.payments,
        orderDiscount: parsed.data.orderDiscount,
        notes: parsed.data.notes ?? null,
        idempotencyKey: parsed.data.idempotencyKey,
        source: parsed.data.source,
        taxInclusive: parsed.data.taxInclusive,
        offlineCreatedAt: parsed.data.offlineCreatedAt ? new Date(parsed.data.offlineCreatedAt) : null,
        registerId: parsed.data.registerId ?? null,
        receiptEmail: parsed.data.receiptEmail ?? null,
      },
    );

    return NextResponse.json({ ok: true, data: result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = () => jsonError("Method not allowed", 405);
