import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  branches,
  products,
  purchaseOrderItems,
  purchaseOrders,
  saleItems,
  sales,
  stockLevels,
  stockMovements,
  stockTransferItems,
  stockTransfers,
  suppliers,
} from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { add, fromMinor, money, multiply, sub, sum, toMinor } from "@/server/lib/money";
import { addQty, fromQty, gtQty, ltQty, subQty, toQty } from "@/server/lib/money";

export type MovementType = "sale" | "refund" | "purchase" | "adjustment" | "transfer_out" | "transfer_in" | "opening" | "wastage";

export class InsufficientStockError extends Error {
  constructor(public readonly productId: string, public readonly available: string, public readonly requested: string) {
    super(`Insufficient stock for product ${productId}: available ${available}, requested ${requested}`);
    this.name = "InsufficientStockError";
  }
}

export class BranchScopeError extends Error {
  constructor() {
    super("Branch does not belong to this business");
    this.name = "BranchScopeError";
  }
}

export async function assertBranch(db: DbLike, tenantId: string, branchId: string): Promise<void> {
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new BranchScopeError();
}

async function getOrCreateLevel(db: DbLike, tenantId: string, branchId: string, productId: string, variantId: string | null) {
  const scope = and(
    eq(stockLevels.tenantId, tenantId),
    eq(stockLevels.branchId, branchId),
    eq(stockLevels.productId, productId),
    variantId ? eq(stockLevels.variantId, variantId) : isNull(stockLevels.variantId),
  );
  const [existing] = await db.select().from(stockLevels).where(scope).for("update").limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(stockLevels)
    .values({ tenantId, branchId, productId, variantId, quantity: "0", avgCost: "0" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(stockLevels).where(scope).for("update").limit(1);
  return raced!;
}

/**
 * THE single mutation path for stock.
 *
 * · locks the level row (SELECT … FOR UPDATE) so concurrent sales serialise
 * · applies the delta and the weighted-average cost in SQL, atomically
 * · refuses to go negative unless explicitly allowed
 * · always appends to the immutable movement ledger with the resulting balance
 */
export async function applyStockMovement(
  db: DbLike,
  input: {
    tenantId: string;
    branchId: string;
    productId: string;
    variantId?: string | null;
    type: MovementType;
    quantityDelta: string;
    unitCost?: string;
    referenceType?: string;
    referenceId?: string;
    reason?: string;
    createdBy?: string | null;
    allowNegative?: boolean;
  },
): Promise<{ balanceAfter: string; movementId: string }> {
  const delta = fromQty(toQty(input.quantityDelta));
  if (toQty(delta) === 0n) throw new Error("Stock movement must not be zero");

  const level = await getOrCreateLevel(db, input.tenantId, input.branchId, input.productId, input.variantId ?? null);
  const current = fromQty(toQty(level.quantity));
  const next = addQty(current, delta);

  if (ltQty(next, "0") && !input.allowNegative) {
    throw new InsufficientStockError(input.productId, current, fromQty(-toQty(delta)));
  }

  // weighted average cost on inbound movements that carry a cost
  let nextAvg = level.avgCost;
  if (toQty(delta) > 0n && input.unitCost && toMinor(input.unitCost) > 0n) {
    const currentValue = multiply(current, level.avgCost);
    const inboundValue = multiply(delta, input.unitCost);
    const totalQty = toQty(next);
    nextAvg = totalQty > 0n ? fromMinor((toMinor(add(currentValue, inboundValue)) * 1000n) / totalQty) : money(input.unitCost);
  }

  const [updated] = await db
    .update(stockLevels)
    .set({
      quantity: sql`${stockLevels.quantity} + ${delta}`,
      avgCost: nextAvg,
      updatedAt: new Date(),
    })
    .where(eq(stockLevels.id, level.id))
    .returning({ quantity: stockLevels.quantity });

  const balanceAfter = fromQty(toQty(updated!.quantity));

  const [movement] = await db
    .insert(stockMovements)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      type: input.type,
      quantityDelta: delta,
      unitCost: money(input.unitCost ?? level.avgCost),
      balanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: stockMovements.id });

  return { balanceAfter, movementId: movement!.id };
}

export async function stockFor(
  db: DbLike,
  tenantId: string,
  branchId: string,
  productIds?: string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.tenantId, tenantId), eq(stockLevels.branchId, branchId)));
  const map = new Map<string, string>();
  for (const row of rows) {
    if (productIds && !productIds.includes(row.productId)) continue;
    map.set(row.productId, addQty(map.get(row.productId) ?? "0", row.quantity));
  }
  return map;
}

export async function adjustStock(
  db: DbLike,
  input: {
    tenantId: string;
    branchId: string;
    productId: string;
    variantId?: string | null;
    newQuantity: string;
    reason: string;
    userId: string;
  },
) {
  await assertBranch(db, input.tenantId, input.branchId);
  const level = await getOrCreateLevel(db, input.tenantId, input.branchId, input.productId, input.variantId ?? null);
  const delta = subQty(input.newQuantity, level.quantity);
  if (toQty(delta) === 0n) return { balanceAfter: fromQty(toQty(level.quantity)), movementId: null };
  return applyStockMovement(db, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    productId: input.productId,
    variantId: input.variantId,
    type: toQty(delta) > 0n ? "adjustment" : "adjustment",
    quantityDelta: delta,
    reason: input.reason,
    createdBy: input.userId,
    allowNegative: false,
  });
}

export async function createTransfer(
  db: DbLike,
  input: {
    tenantId: string;
    userId: string;
    fromBranchId: string;
    toBranchId: string;
    items: { productId: string; variantId?: string | null; quantity: string }[];
    notes?: string;
  },
) {
  await assertBranch(db, input.tenantId, input.fromBranchId);
  await assertBranch(db, input.tenantId, input.toBranchId);
  if (input.fromBranchId === input.toBranchId) throw new Error("Choose two different branches");

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockTransfers)
    .where(eq(stockTransfers.tenantId, input.tenantId));
  const reference = `TRF-${String(count + 1).padStart(5, "0")}`;

  const [transfer] = await db
    .insert(stockTransfers)
    .values({
      tenantId: input.tenantId,
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      reference,
      status: "in_transit",
      notes: input.notes ?? null,
      createdBy: input.userId,
    })
    .returning({ id: stockTransfers.id });

  await db.insert(stockTransferItems).values(
    input.items.map((i) => ({
      tenantId: input.tenantId,
      transferId: transfer!.id,
      productId: i.productId,
      variantId: i.variantId ?? null,
      quantity: i.quantity,
    })),
  );

  for (const item of input.items) {
    await applyStockMovement(db, {
      tenantId: input.tenantId,
      branchId: input.fromBranchId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      type: "transfer_out",
      quantityDelta: `-${item.quantity}`,
      referenceType: "transfer",
      referenceId: transfer!.id,
      reason: `Transfer ${reference}`,
      createdBy: input.userId,
    });
  }
  return transfer!;
}

export async function receiveTransfer(db: DbLike, input: { tenantId: string; transferId: string; userId: string }) {
  const [transfer] = await db
    .select()
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, input.transferId), eq(stockTransfers.tenantId, input.tenantId)))
    .for("update")
    .limit(1);
  if (!transfer) throw new Error("Transfer not found");
  if (transfer.status === "received") return transfer;

  const items = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transfer.id));
  for (const item of items) {
    await applyStockMovement(db, {
      tenantId: input.tenantId,
      branchId: transfer.toBranchId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      type: "transfer_in",
      quantityDelta: item.quantity,
      referenceType: "transfer",
      referenceId: transfer.id,
      reason: `Transfer ${transfer.reference}`,
      createdBy: input.userId,
    });
  }
  await db
    .update(stockTransfers)
    .set({ status: "received", receivedAt: new Date() })
    .where(eq(stockTransfers.id, transfer.id));
  return { ...transfer, status: "received" as const };
}

export async function createPurchaseOrder(
  db: DbLike,
  input: {
    tenantId: string;
    userId: string;
    branchId: string;
    supplierId: string;
    items: { productId: string; variantId?: string | null; quantity: string; unitCost: string }[];
    expectedAt?: Date | null;
    notes?: string;
  },
) {
  await assertBranch(db, input.tenantId, input.branchId);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.tenantId, input.tenantId));
  const reference = `PO-${String(count + 1).padStart(5, "0")}`;
  const subtotal = sum(input.items.map((i) => multiply(i.quantity, i.unitCost)));
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      reference,
      status: "ordered",
      subtotal,
      total: subtotal,
      expectedAt: input.expectedAt ?? null,
      notes: input.notes ?? null,
      createdBy: input.userId,
    })
    .returning({ id: purchaseOrders.id });
  await db.insert(purchaseOrderItems).values(
    input.items.map((i) => ({
      tenantId: input.tenantId,
      purchaseOrderId: po!.id,
      productId: i.productId,
      variantId: i.variantId ?? null,
      quantity: i.quantity,
      unitCost: i.unitCost,
    })),
  );
  return { id: po!.id, reference };
}

export async function receivePurchaseOrder(db: DbLike, input: { tenantId: string; poId: string; userId: string }) {
  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, input.poId), eq(purchaseOrders.tenantId, input.tenantId)))
    .for("update")
    .limit(1);
  if (!po) throw new Error("Purchase order not found");
  if (po.status === "received") return po;
  const items = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
  for (const item of items) {
    const outstanding = subQty(item.quantity, item.receivedQty);
    if (toQty(outstanding) <= 0n) continue;
    await applyStockMovement(db, {
      tenantId: input.tenantId,
      branchId: po.branchId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      type: "purchase",
      quantityDelta: outstanding,
      unitCost: item.unitCost,
      referenceType: "purchase_order",
      referenceId: po.id,
      reason: `Received ${po.reference}`,
      createdBy: input.userId,
    });
    await db.update(purchaseOrderItems).set({ receivedQty: item.quantity }).where(eq(purchaseOrderItems.id, item.id));
  }
  await db.update(purchaseOrders).set({ status: "received", updatedAt: new Date() }).where(eq(purchaseOrders.id, po.id));
  if (toMinor(po.total) > toMinor(po.amountPaid)) {
    const owed = sub(po.total, po.amountPaid);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
    if (supplier) {
      await db
        .update(suppliers)
        .set({ balanceOwed: add(supplier.balanceOwed, owed), updatedAt: new Date() })
        .where(eq(suppliers.id, supplier.id));
    }
  }
  return po;
}

/* ───────────────────────────── analytics / AI ───────────────────────────── */

export async function inventoryValuation(db: DbLike, tenantId: string) {
  const rows = await db
    .select({
      branchId: stockLevels.branchId,
      quantity: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)::text`,
      value: sql<string>`coalesce(sum(${stockLevels.quantity} * ${stockLevels.avgCost}), 0)::text`,
    })
    .from(stockLevels)
    .where(eq(stockLevels.tenantId, tenantId))
    .groupBy(stockLevels.branchId);
  return rows.map((r) => ({ branchId: r.branchId, quantity: money(r.quantity), value: money(r.value) }));
}

export async function lowStockItems(db: DbLike, tenantId: string, branchId: string) {
  const rows = await db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      reorderPoint: products.reorderPoint,
      reorderQty: products.reorderQty,
      costPrice: products.costPrice,
      quantity: sql<string>`coalesce(${stockLevels.quantity}, 0)::text`,
    })
    .from(products)
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.branchId, branchId), eq(stockLevels.tenantId, tenantId)),
    )
    .where(and(eq(products.tenantId, tenantId), eq(products.trackStock, true), eq(products.isActive, true)))
    .orderBy(asc(products.name));

  return rows
    .map((r) => ({
      ...r,
      quantity: fromQty(toQty(r.quantity)),
      shortfall: subQty(r.reorderPoint, r.quantity),
      isLow: ltQty(r.quantity, r.reorderPoint) || toQty(r.quantity) <= 0n,
    }))
    .filter((r) => r.isLow);
}

/** Units sold per product over a window — the base signal for demand forecasting. */
export async function salesVelocity(db: DbLike, tenantId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await db
    .select({
      productId: saleItems.productId,
      name: saleItems.name,
      quantity: sql<string>`coalesce(sum(${saleItems.quantity}), 0)::text`,
      revenue: sql<string>`coalesce(sum(${saleItems.lineTotal}), 0)::text`,
      cost: sql<string>`coalesce(sum(${saleItems.unitCost} * ${saleItems.quantity}), 0)::text`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(saleItems.tenantId, tenantId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, since),
      ),
    )
    .groupBy(saleItems.productId, saleItems.name);
  return rows
    .filter((r) => r.productId)
    .map((r) => {
      const quantity = fromQty(toQty(r.quantity));
      const daily = fromQty(toQty(r.quantity) / BigInt(days));
      return {
        productId: r.productId!,
        name: r.name,
        quantity,
        dailyVelocity: daily,
        revenue: money(r.revenue),
        cost: money(r.cost),
        grossProfit: sub(money(r.revenue), money(r.cost)),
      };
    })
    .sort((a, b) => Number(b.quantity) - Number(a.quantity));
}

export type RestockRecommendation = {
  productId: string;
  name: string;
  sku: string;
  onHand: string;
  dailyVelocity: string;
  daysOfCover: number;
  suggestedQty: string;
  estimatedCost: string;
  urgency: "critical" | "high" | "medium" | "low";
  reasoning: string;
};

/**
 * Deterministic reorder engine: demand velocity × lead time + safety stock,
 * minus current on-hand. The LLM narrates this; it never computes it.
 */
export async function recommendRestock(
  db: DbLike,
  tenantId: string,
  branchId: string,
  opts: { leadTimeDays?: number; coverDays?: number } = {},
): Promise<RestockRecommendation[]> {
  const leadTime = opts.leadTimeDays ?? 7;
  const coverDays = opts.coverDays ?? 14;
  const velocity = await salesVelocity(db, tenantId, 30);
  const onHand = await stockFor(db, tenantId, branchId);
  const productRows = await db.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)));
  const byId = new Map(productRows.map((p) => [p.id, p]));

  const results: RestockRecommendation[] = [];
  for (const v of velocity) {
    const product = byId.get(v.productId);
    if (!product || !product.trackStock) continue;
    const available = onHand.get(v.productId) ?? "0";
    const daily = Number(v.dailyVelocity);
    if (daily <= 0) continue;
    const daysOfCoverRaw = Number(available) / daily;
    const target = Math.ceil(daily * (leadTime + coverDays));
    const suggested = Math.max(0, target - Number(available));
    if (suggested <= 0 && daysOfCoverRaw > leadTime) continue;
    const suggestedQty = fromQty(BigInt(Math.ceil(suggested)) * 1000n);
    const urgency: RestockRecommendation["urgency"] =
      daysOfCoverRaw <= 2 ? "critical" : daysOfCoverRaw <= leadTime ? "high" : daysOfCoverRaw <= leadTime + coverDays ? "medium" : "low";
    results.push({
      productId: v.productId,
      name: v.name,
      sku: product.sku,
      onHand: available,
      dailyVelocity: v.dailyVelocity,
      daysOfCover: Math.round(daysOfCoverRaw * 10) / 10,
      suggestedQty,
      estimatedCost: multiply(suggestedQty, product.costPrice),
      urgency,
      reasoning: `Sells ${Number(v.dailyVelocity).toFixed(2)}/day; ${daysOfCoverRaw.toFixed(1)} days of cover at current stock with a ${leadTime}-day lead time.`,
    });
  }
  return results.sort((a, b) => a.daysOfCover - b.daysOfCover);
}

export async function slowMovingProducts(db: DbLike, tenantId: string, days = 30) {
  const velocity = await salesVelocity(db, tenantId, days);
  const sold = new Set(velocity.map((v) => v.productId));
  const rows = await db.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)));
  const valuation = await inventoryValuation(db, tenantId);
  const totalValue = sum(valuation.map((v) => v.value));
  return {
    totalValue,
    products: rows
      .filter((p) => !sold.has(p.id) && p.trackStock)
      .slice(0, 25)
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku, cost: p.costPrice, price: p.price })),
  };
}

/** Detects suspicious stock movements (possible loss / shrink). */
export async function shrinkageSignals(db: DbLike, tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await db
    .select({
      productId: stockMovements.productId,
      type: stockMovements.type,
      total: sql<string>`coalesce(sum(abs(${stockMovements.quantityDelta})), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), gte(stockMovements.createdAt, since)))
    .groupBy(stockMovements.productId, stockMovements.type);

  const productRows = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.tenantId, tenantId));
  const names = new Map(productRows.map((p) => [p.id, p.name]));
  const adjustments = rows.filter((r) => r.type === "adjustment" || r.type === "wastage");
  const sold = new Map(rows.filter((r) => r.type === "sale").map((r) => [r.productId, Number(r.total)]));
  return adjustments
    .map((r) => {
      const soldQty = sold.get(r.productId) ?? 0;
      const adjustmentQty = Number(r.total);
      const ratio = soldQty > 0 ? adjustmentQty / soldQty : 1;
      return {
        productId: r.productId,
        name: names.get(r.productId) ?? "Unknown",
        adjustmentQty: fromQty(toQty(r.total)),
        soldQty: fromQty(toQty(String(soldQty))),
        adjustmentRatio: Math.round(ratio * 100) / 100,
        suspicious: ratio > 0.1 || (soldQty === 0 && adjustmentQty > 0),
        events: r.count,
      };
    })
    .filter((r) => r.suspicious)
    .sort((a, b) => b.adjustmentRatio - a.adjustmentRatio)
    .slice(0, 20);
}

export async function movementLedger(db: DbLike, tenantId: string, limit = 50) {
  return db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantityDelta: stockMovements.quantityDelta,
      balanceAfter: stockMovements.balanceAfter,
      reason: stockMovements.reason,
      referenceId: stockMovements.referenceId,
      createdAt: stockMovements.createdAt,
      productName: products.name,
      branchName: branches.name,
    })
    .from(stockMovements)
    .leftJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(branches, eq(branches.id, stockMovements.branchId))
    .where(eq(stockMovements.tenantId, tenantId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
}

export const stockSearchWhere = (tenantId: string, term: string) =>
  and(
    eq(products.tenantId, tenantId),
    or(
      sql`lower(${products.name}) like ${`%${term.toLowerCase()}%`}`,
      sql`lower(${products.sku}) like ${`%${term.toLowerCase()}%`}`,
      sql`${products.barcode} = ${term}`,
    ),
  );

export { fromQty, toQty, gtQty, addQty };
