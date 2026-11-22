"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { saleItems } from "@/server/db/schema";
import { actionCtx, failure } from "./ctx";
import { refundSale, voidSale } from "@/server/services/sales";

export async function refundSaleAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("sales.refund");
    const saleId = String(formData.get("saleId"));
    const [item] = await ctx.db.select().from(saleItems).where(and(eq(saleItems.saleId, saleId), eq(saleItems.tenantId, ctx.tenantId))).limit(1);
    const result = await refundSale(
      { db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId, permissions: ctx.permissions },
      {
        saleId,
        items: item ? [{ saleItemId: item.id, quantity: "1.000" }] : undefined,
        reason: String(formData.get("reason") ?? "Customer return"),
        method: String(formData.get("method") ?? "cash") as "cash" | "card" | "transfer",
        restock: formData.get("restock") !== "off",
      },
    );
    await ctx.audit({ action: "sale.refund", entity: "sale", entityId: saleId, severity: "warning", metadata: { amount: result.amount, reason: String(formData.get("reason") ?? "") } });
    revalidatePath("/sales");
    revalidatePath("/finance");
    return { ok: true, message: `Refund of ${result.amount} recorded` };
  } catch (error) {
    return failure(error);
  }
}

export async function voidSaleAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx(["sales.void", "sales.refund"]);
    const saleId = String(formData.get("saleId"));
    await voidSale({ db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId }, { saleId, reason: String(formData.get("reason") ?? "Voided by staff") });
    await ctx.audit({ action: "sale.void", entity: "sale", entityId: saleId, severity: "critical", metadata: { reason: String(formData.get("reason") ?? "") } });
    revalidatePath("/sales");
    return { ok: true, message: "Sale voided and stock restored" };
  } catch (error) {
    return failure(error);
  }
}
