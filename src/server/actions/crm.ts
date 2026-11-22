"use server";

import { revalidatePath } from "next/cache";
import { customerSchema, zJson } from "@/server/lib/validation";

function withCheckboxes(formData: FormData): Record<string, unknown> {
  return { ...Object.fromEntries(formData), marketingConsent: formData.get("marketingConsent") === "on", whatsappConsent: formData.get("whatsappConsent") === "on" };
}
import { actionCtx, failure } from "./ctx";
import { createCustomer, recordPaymentOnAccount } from "@/server/services/crm";

export async function createCustomerAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("customers.manage");
    const parsed = zJson(customerSchema, withCheckboxes(formData));
    const row = await createCustomer(ctx.db, ctx.tenantId, {
      ...parsed,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      notes: parsed.notes || null,
      creditLimit: parsed.creditLimit,
    });
    await ctx.audit({ action: "customer.create", entity: "customer", entityId: row.id, metadata: { name: parsed.name } });
    revalidatePath("/customers");
    return { ok: true, message: `${parsed.name} added` };
  } catch (error) {
    return failure(error);
  }
}

export async function recordCustomerPaymentAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("customers.manage");
    const customerId = String(formData.get("customerId"));
    const amount = String(formData.get("amount") ?? "0");
    if (Number(amount) <= 0) throw new Error("Enter an amount greater than zero");
    const result = await recordPaymentOnAccount(ctx.db, ctx.tenantId, { customerId, amount });
    await ctx.audit({ action: "customer.payment", entity: "customer", entityId: customerId, metadata: { amount, balanceAfter: result.balanceOwed } });
    revalidatePath("/customers");
    revalidatePath("/finance");
    return { ok: true, message: `Payment recorded. Balance now ${result.balanceOwed}` };
  } catch (error) {
    return failure(error);
  }
}
