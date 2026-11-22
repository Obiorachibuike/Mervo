"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { categories, products, purchaseOrders, suppliers } from "@/server/db/schema";
import { productSchema, supplierSchema, zJson, ValidationError } from "@/server/lib/validation";
import { actionCtx, failure } from "./ctx";
import { adjustStock, createPurchaseOrder, createTransfer, receivePurchaseOrder, receiveTransfer } from "@/server/services/inventory";
import { recordExpense } from "@/server/services/finance";
import { assertWithinLimit } from "@/server/services/subscriptions";

/** FormData checkboxes arrive as "on"; schemas want booleans. */
function withFlags(formData: FormData, flags: string[]): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(formData);
  for (const flag of flags) raw[flag] = formData.get(flag) === "on" || formData.get(flag) === "true";
  return raw;
}

export async function createProductAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx(["inventory.create"]);
    await assertWithinLimit(ctx.db, ctx.tenantId, "products");
    const parsed = zJson(productSchema, withFlags(formData, ["trackStock", "isMenuItem"]));
    const existing = await ctx.db.select({ id: products.id }).from(products).where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, parsed.sku))).limit(1);
    if (existing.length) throw new ValidationError("A product with that SKU already exists");
    const [row] = await ctx.db
      .insert(products)
      .values({
        tenantId: ctx.tenantId,
        name: parsed.name,
        sku: parsed.sku,
        barcode: parsed.barcode || null,
        categoryId: parsed.categoryId || null,
        supplierId: parsed.supplierId || null,
        description: parsed.description || null,
        brand: parsed.brand || null,
        unit: parsed.unit,
        costPrice: parsed.costPrice,
        price: parsed.price,
        wholesalePrice: parsed.wholesalePrice || null,
        taxRate: String(parsed.taxRate),
        trackStock: parsed.trackStock,
        reorderPoint: parsed.reorderPoint,
        reorderQty: parsed.reorderQty,
        isMenuItem: parsed.isMenuItem,
      })
      .returning({ id: products.id });
    const openingQty = String(formData.get("openingStock") ?? "0");
    const branchId = String(formData.get("branchId") ?? "");
    if (branchId && Number(openingQty) > 0) {
      await adjustStock(ctx.db, { tenantId: ctx.tenantId, branchId, productId: row!.id, newQuantity: openingQty, reason: "Opening stock on create", userId: ctx.userId });
    }
    await ctx.audit({ action: "product.create", entity: "product", entityId: row!.id, metadata: { name: parsed.name, sku: parsed.sku, price: parsed.price } });
    revalidatePath("/products");
    revalidatePath("/pos");
    return { ok: true, message: `${parsed.name} added` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateProductAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx(["inventory.create"]);
    const id = String(formData.get("id"));
    const parsed = zJson(productSchema, withFlags(formData, ["trackStock", "isMenuItem"]));
    const [row] = await ctx.db
      .update(products)
      .set({
        name: parsed.name,
        price: parsed.price,
        costPrice: parsed.costPrice,
        taxRate: String(parsed.taxRate),
        reorderPoint: parsed.reorderPoint,
        reorderQty: parsed.reorderQty,
        barcode: parsed.barcode || null,
        isActive: formData.get("isActive") !== "false",
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
      .returning({ id: products.id });
    if (!row) throw new ValidationError("Product not found in this workspace");
    await ctx.audit({ action: "product.update", entity: "product", entityId: id, metadata: { price: parsed.price } });
    revalidatePath("/products");
    revalidatePath("/pos");
    return { ok: true, message: "Product updated" };
  } catch (error) {
    return failure(error);
  }
}

export async function createCategoryAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.create");
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2) throw new ValidationError("Category name is too short");
    await ctx.db.insert(categories).values({ tenantId: ctx.tenantId, name });
    revalidatePath("/products");
    return { ok: true, message: `Category “${name}” created` };
  } catch (error) {
    return failure(error);
  }
}

export async function adjustStockAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.adjust");
    const productId = String(formData.get("productId"));
    const branchId = String(formData.get("branchId"));
    const newQuantity = String(formData.get("quantity"));
    const reason = String(formData.get("reason") ?? "Manual adjustment");
    const result = await adjustStock(ctx.db, { tenantId: ctx.tenantId, branchId, productId, newQuantity, reason, userId: ctx.userId });
    await ctx.audit({ action: "inventory.adjust", entity: "stock_level", entityId: productId, severity: "warning", metadata: { newQuantity, balanceAfter: result.balanceAfter, reason } });
    revalidatePath("/inventory");
    revalidatePath("/pos");
    return { ok: true, message: `Stock updated to ${result.balanceAfter}` };
  } catch (error) {
    return failure(error);
  }
}

export async function transferStockAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.transfer");
    const productId = String(formData.get("productId"));
    const quantity = String(formData.get("quantity"));
    const fromBranchId = String(formData.get("fromBranchId"));
    const toBranchId = String(formData.get("toBranchId"));
    if (fromBranchId === toBranchId) throw new ValidationError("Choose two different branches");
    const transfer = await createTransfer(ctx.db, { tenantId: ctx.tenantId, userId: ctx.userId, fromBranchId, toBranchId, items: [{ productId, quantity }], notes: String(formData.get("notes") ?? "") || undefined });
    await ctx.audit({ action: "inventory.transfer", entity: "stock_transfer", entityId: transfer.id, metadata: { productId, quantity, fromBranchId, toBranchId } });
    if (formData.get("receiveNow") === "on") {
      await receiveTransfer(ctx.db, { tenantId: ctx.tenantId, transferId: transfer.id, userId: ctx.userId });
      revalidatePath("/inventory");
      return { ok: true, message: "Stock transferred and received" };
    }
    revalidatePath("/inventory");
    return { ok: true, message: "Transfer created in transit" };
  } catch (error) {
    return failure(error);
  }
}

export async function receiveTransferAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.transfer");
    await receiveTransfer(ctx.db, { tenantId: ctx.tenantId, transferId: String(formData.get("transferId")), userId: ctx.userId });
    revalidatePath("/inventory");
    return { ok: true, message: "Transfer received" };
  } catch (error) {
    return failure(error);
  }
}

export async function createSupplierAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.purchase");
    const parsed = zJson(supplierSchema, Object.fromEntries(formData));
    const [row] = await ctx.db
      .insert(suppliers)
      .values({ tenantId: ctx.tenantId, name: parsed.name, contactName: parsed.contactName || null, phone: parsed.phone || null, email: parsed.email || null, address: parsed.address || null, notes: parsed.notes || null })
      .returning({ id: suppliers.id });
    await ctx.audit({ action: "supplier.create", entity: "supplier", entityId: row!.id });
    revalidatePath("/suppliers");
    return { ok: true, message: `${parsed.name} added` };
  } catch (error) {
    return failure(error);
  }
}

export async function createPurchaseOrderAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.purchase");
    const productId = String(formData.get("productId"));
    const quantity = String(formData.get("quantity"));
    const unitCost = String(formData.get("unitCost"));
    const supplierId = String(formData.get("supplierId"));
    const branchId = String(formData.get("branchId"));
    const po = await createPurchaseOrder(ctx.db, { tenantId: ctx.tenantId, userId: ctx.userId, branchId, supplierId, items: [{ productId, quantity, unitCost }] });
    await ctx.audit({ action: "purchase_order.create", entity: "purchase_order", entityId: po.id, metadata: { reference: po.reference } });
    revalidatePath("/suppliers");
    return { ok: true, message: `Purchase order ${po.reference} created` };
  } catch (error) {
    return failure(error);
  }
}

export async function receivePurchaseOrderAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("inventory.purchase");
    const poId = String(formData.get("poId"));
    const [po] = await ctx.db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.tenantId, ctx.tenantId))).limit(1);
    if (!po) throw new ValidationError("Purchase order not found");
    await receivePurchaseOrder(ctx.db, { tenantId: ctx.tenantId, poId, userId: ctx.userId });
    await ctx.audit({ action: "purchase_order.receive", entity: "purchase_order", entityId: poId, metadata: { reference: po.reference, total: po.total } });
    revalidatePath("/suppliers");
    revalidatePath("/inventory");
    return { ok: true, message: `${po.reference} received into stock` };
  } catch (error) {
    return failure(error);
  }
}

export async function recordExpenseFromFormAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("finance.manage");
    const description = String(formData.get("description") ?? "").trim();
    const amount = String(formData.get("amount") ?? "0");
    if (description.length < 2) throw new ValidationError("Describe the expense");
    if (Number(amount) <= 0) throw new ValidationError("Amount must be greater than zero");
    await recordExpense(ctx.db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      description,
      amount,
      method: String(formData.get("method") ?? "cash"),
      branchId: String(formData.get("branchId") ?? "") || null,
      date: formData.get("date") ? new Date(String(formData.get("date"))) : new Date(),
    });
    await ctx.audit({ action: "expense.create", entity: "expense", metadata: { description, amount } });
    revalidatePath("/finance");
    return { ok: true, message: "Expense recorded and posted to the ledger" };
  } catch (error) {
    return failure(error);
  }
}
