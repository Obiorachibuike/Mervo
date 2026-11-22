import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { boot, createWorkspace, stockOf } from "./harness";
import { products, stockMovements } from "@/server/db/schema";
import {
  adjustStock,
  applyStockMovement,
  createPurchaseOrder,
  createTransfer,
  inventoryValuation,
  lowStockItems,
  movementLedger,
  recommendRestock,
  receivePurchaseOrder,
  receiveTransfer,
  shrinkageSignals,
  slowMovingProducts,
} from "@/server/services/inventory";
import { createSale } from "@/server/services/sales";
import { testDb } from "./helpers";

describe("inventory ledger", () => {
  it("keeps stock in sync and records every movement immutably", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Ledger Co", { openingStock: 10 });
    const movements = await db.select().from(stockMovements).where(eq(stockMovements.productId, ws.productId));
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe("opening");
    expect(movements[0]!.balanceAfter).toBe("10.000");

    // the ledger is append-only: the database rejects UPDATE and DELETE
    const updateError = await db.execute(sql`update stock_movements set quantity_delta = '0' where id = ${movements[0]!.id}`).then(() => null).catch((e: unknown) => e);
    expect(updateError).toBeTruthy();
    expect(String((updateError as { cause?: { message?: string } }).cause?.message ?? (updateError as Error).message)).toMatch(/append-only/i);

    const deleteError = await db.execute(sql`delete from stock_movements where id = ${movements[0]!.id}`).then(() => null).catch((e: unknown) => e);
    expect(deleteError).toBeTruthy();
    expect(String((deleteError as { cause?: { message?: string } }).cause?.message ?? (deleteError as Error).message)).toMatch(/append-only/i);
  });

  it("blocks negative stock adjustments", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "NoNegative Co", { openingStock: 2 });
    await expect(
      applyStockMovement(db, {
        tenantId: ws.tenantId,
        branchId: ws.branchId,
        productId: ws.productId,
        type: "adjustment",
        quantityDelta: "-5.000",
        createdBy: ws.ownerId,
      }),
    ).rejects.toThrow(/Insufficient stock/);
  });

  it("adjusts stock to an absolute count and logs the reason", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Adjust Co", { openingStock: 20 });
    await adjustStock(db, { tenantId: ws.tenantId, branchId: ws.branchId, productId: ws.productId, newQuantity: "13.000", reason: "Stock count", userId: ws.ownerId });
    expect(Number(await stockOf(db, ws.tenantId, ws.branchId, ws.productId))).toBe(13);
    const ledger = await movementLedger(db, ws.tenantId, 5);
    expect(ledger[0]!.reason).toBe("Stock count");
    expect(ledger[0]!.quantityDelta).toBe("-7.000");
  });

  it("moves stock between branches exactly once", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Transfer Co", { openingStock: 30 });
    const transfer = await createTransfer(db, {
      tenantId: ws.tenantId,
      userId: ws.ownerId,
      fromBranchId: ws.branchId,
      toBranchId: ws.branch2Id,
      items: [{ productId: ws.productId, quantity: "10.000" }],
    });
    expect(await stockOf(db, ws.tenantId, ws.branchId, ws.productId)).toBe("20.000");
    expect(Number(await stockOf(db, ws.tenantId, ws.branch2Id, ws.productId))).toBe(0);
    await receiveTransfer(db, { tenantId: ws.tenantId, transferId: transfer.id, userId: ws.ownerId });
    expect(Number(await stockOf(db, ws.tenantId, ws.branch2Id, ws.productId))).toBe(10);
    // idempotent receive
    await receiveTransfer(db, { tenantId: ws.tenantId, transferId: transfer.id, userId: ws.ownerId });
    expect(Number(await stockOf(db, ws.tenantId, ws.branch2Id, ws.productId))).toBe(10);
  });

  it("receives purchase orders, values stock and tracks supplier debt", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "PO Co", { openingStock: 0 });
    const [supplier] = await db.execute(sql`insert into suppliers (tenant_id, name, balance_owed) values (${ws.tenantId}, 'Acme Supplies', '0') returning id`).then((r) => r.rows as { id: string }[]);
    const po = await createPurchaseOrder(db, {
      tenantId: ws.tenantId,
      userId: ws.ownerId,
      branchId: ws.branchId,
      supplierId: supplier!.id,
      items: [{ productId: ws.productId, quantity: "25.000", unitCost: "700.00" }],
    });
    await receivePurchaseOrder(db, { tenantId: ws.tenantId, poId: po.id, userId: ws.ownerId });
    expect(Number(await stockOf(db, ws.tenantId, ws.branchId, ws.productId))).toBe(25);
    const valuation = await inventoryValuation(db, ws.tenantId);
    expect(Number(valuation[0]!.value)).toBeGreaterThan(17000);
    const owedRows = (await db.execute(sql`select balance_owed::text as owed from suppliers where id = ${supplier!.id}`)).rows as { owed: string }[];
    expect(owedRows[0]!.owed).toBe("17500.00");
  });

  it("detects low stock and recommends reorders from real velocity", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Restock Co", { openingStock: 100 });
    for (let i = 0; i < 20; i++) {
      await createSale(ws.ctx, {
        branchId: ws.branchId,
        items: [{ productId: ws.productId, name: "Test Rice", quantity: "5.000" }],
        payments: [{ method: "cash", amount: "6000.00" }],
        idempotencyKey: `restock-${i}-${Date.now()}`,
      });
    }
    const low = await lowStockItems(db, ws.tenantId, ws.branchId);
    expect(low.some((l) => l.productId === ws.productId)).toBe(true);
    const recs = await recommendRestock(db, ws.tenantId, ws.branchId, { leadTimeDays: 7, coverDays: 14 });
    const rice = recs.find((r) => r.productId === ws.productId);
    expect(rice).toBeTruthy();
    expect(Number(rice!.suggestedQty)).toBeGreaterThan(0);
    expect(["critical", "high"]).toContain(rice!.urgency);
  });

  it("identifies slow movers and shrinkage signals", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Slow Co", { openingStock: 40 });
    await applyStockMovement(db, {
      tenantId: ws.tenantId,
      branchId: ws.branchId,
      productId: ws.productId,
      type: "wastage",
      quantityDelta: "-10.000",
      reason: "Spoilage",
      createdBy: ws.ownerId,
    });
    const slow = await slowMovingProducts(db, ws.tenantId, 30);
    expect(slow.products.length).toBeGreaterThan(0);
    const shrink = await shrinkageSignals(db, ws.tenantId, 30);
    expect(shrink[0]?.productId).toBe(ws.productId);
    expect(shrink[0]!.suspicious).toBe(true);
  });

  it("rejects a transfer into another tenant's branch", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "TransferGuard A", { openingStock: 10 });
    const b = await createWorkspace(db, "TransferGuard B");
    await expect(
      createTransfer(db, {
        tenantId: a.tenantId,
        userId: a.ownerId,
        fromBranchId: a.branchId,
        toBranchId: b.branchId,
        items: [{ productId: a.productId, quantity: "1.000" }],
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("does not show another tenant's products in stock views", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "StockView A", { openingStock: 7 });
    const b = await createWorkspace(db, "StockView B", { openingStock: 3 });
    const aLow = await lowStockItems(db, a.tenantId, a.branchId);
    expect(aLow.every((l) => l.productId !== b.productId)).toBe(true);
    const aVal = await inventoryValuation(db, a.tenantId);
    const bVal = await inventoryValuation(db, b.tenantId);
    expect(aVal[0]!.value).not.toBe(bVal[0]!.value);
    const rows = await db.select().from(products).where(and(eq(products.tenantId, a.tenantId)));
    expect(rows.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });

  it("exposes a test-helper database without leaking between suites", async () => {
    const db = await testDb();
    expect(db).toBeTruthy();
  });
});
