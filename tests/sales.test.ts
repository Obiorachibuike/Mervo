import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { boot, createWorkspace, stockOf } from "./harness";
import { auditLogs, journalEntries, journalLines, payments, refunds, saleItems, sales } from "@/server/db/schema";
import { buildReceipt, computeCart, createSale, refundSale, voidSale, dailyReconciliation } from "@/server/services/sales";
import { trialBalance } from "@/server/services/finance";

const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;

describe("sales processing", () => {
  it("records a sale, deducts stock and posts a balanced journal", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Sale Co");
    const before = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);

    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "3.000" }],
      payments: [{ method: "cash", amount: "5000.00" }],
      idempotencyKey: key(),
    });

    expect(sale.duplicate).toBe(false);
    expect(sale.total).toBe("3225.00"); // 3000 + 7.5% tax
    expect(sale.changeDue).toBe("1775.00");

    const after = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);
    expect(Number(before) - Number(after)).toBe(3);

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.saleId));
    expect(items).toHaveLength(1);
    expect(items[0]!.unitPrice).toBe("1000.00");

    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, ws.tenantId), eq(journalEntries.referenceId, sale.saleId)));
    expect(entry).toBeTruthy();
    const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry!.id));
    const debit = lines.reduce((a, l) => a + Number(l.debit), 0);
    const credit = lines.reduce((a, l) => a + Number(l.credit), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));

    const tb = await trialBalance(db, ws.tenantId);
    expect(tb.balanced).toBe(true);
  });

  it("is idempotent: replaying the same key never creates a duplicate", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Idempotent Co");
    const idempotencyKey = key();
    const input: Parameters<typeof createSale>[1] = {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
      payments: [{ method: "cash", amount: "2000.00" }],
      idempotencyKey,
    };
    const first = await createSale(ws.ctx, input);
    const second = await createSale(ws.ctx, input);
    const third = await createSale(ws.ctx, input);
    expect(second.duplicate).toBe(true);
    expect(third.saleId).toBe(first.saleId);

    const rows = await db.select().from(sales).where(and(eq(sales.tenantId, ws.tenantId), eq(sales.idempotencyKey, idempotencyKey)));
    expect(rows).toHaveLength(1);
    const stock = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);
    expect(Number(stock)).toBe(49); // deducted exactly once
    const paymentRows = await db.select().from(payments).where(eq(payments.saleId, first.saleId));
    expect(paymentRows).toHaveLength(1);
  });

  it("blocks overselling: concurrent sales cannot push stock negative", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Concurrent Co", { openingStock: 5 });
    const attempts = Array.from({ length: 8 }, (_, i) =>
      createSale(ws.ctx, {
        branchId: ws.branchId,
        items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
        payments: [{ method: "cash", amount: "2000.00" }],
        idempotencyKey: key(),
      }).then(() => "ok" as const).catch(() => "rejected" as const),
    );
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r === "ok").length;
    expect(ok).toBe(5);
    const stock = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);
    expect(Number(stock)).toBe(0);
  });

  it("rejects a credit sale above the customer's credit limit", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Credit Co");
    await expect(
      createSale(ws.ctx, {
        branchId: ws.branchId,
        customerId: ws.customerId,
        items: [{ productId: ws.productId, name: "Test Rice", quantity: "200.000" }],
        payments: [],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(/credit limit/i);
  });

  it("requires a customer for any unpaid balance", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "NoCustomer Co");
    await expect(
      createSale(ws.ctx, {
        branchId: ws.branchId,
        items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
        payments: [],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(/require a customer/i);
  });

  it("supports split payments across methods", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Split Co");
    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [
        { productId: ws.productId, name: "Test Rice", quantity: "1.000" },
        { productId: ws.productIds[1]!, name: "Test Oil", quantity: "1.000" },
      ],
      payments: [
        { method: "cash", amount: "1500.00" },
        { method: "transfer", amount: "2262.50", reference: "TRX-1" },
      ],
      idempotencyKey: key(),
    });
    const rows = await db.select().from(payments).where(eq(payments.saleId, sale.saleId));
    expect(rows).toHaveLength(2);
    expect(sale.balanceDue).toBe("0.00");
  });

  it("partial refund restores stock, reduces totals and keeps the ledger balanced", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Refund Co");
    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "4.000" }],
      payments: [{ method: "cash", amount: "5000.00" }],
      idempotencyKey: key(),
    });
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.saleId));
    const stockBeforeRefund = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);

    const refund = await refundSale(ws.ctx, { saleId: sale.saleId, items: [{ saleItemId: item!.id, quantity: "2.000" }], reason: "Damaged" });
    expect(refund.amount).toBe("2150.00"); // (4300 total / 4) × 2
    expect(refund.fullyRefunded).toBe(false);

    const stockAfter = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);
    expect(Number(stockAfter) - Number(stockBeforeRefund)).toBe(2);

    const [updatedSale] = await db.select().from(sales).where(eq(sales.id, sale.saleId));
    expect(updatedSale!.status).toBe("partially_refunded");

    const tb = await trialBalance(db, ws.tenantId);
    expect(tb.balanced).toBe(true);

    const [logged] = await db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, ws.tenantId), eq(auditLogs.action, "sale.refund")));
    expect(logged?.severity).toBe("warning");
  });

  it("cannot refund more than was sold", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "OverRefund Co");
    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "2.000" }],
      payments: [{ method: "cash", amount: "3000.00" }],
      idempotencyKey: key(),
    });
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.saleId));
    await expect(refundSale(ws.ctx, { saleId: sale.saleId, items: [{ saleItemId: item!.id, quantity: "3.000" }] })).rejects.toThrow(/Cannot refund more/);
  });

  it("voids a sale, restocks inventory and reverses revenue", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Void Co");
    const before = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);
    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "2.000" }],
      payments: [{ method: "cash", amount: "3000.00" }],
      idempotencyKey: key(),
    });
    await voidSale({ db, tenantId: ws.tenantId, userId: ws.ownerId }, { saleId: sale.saleId, reason: "Cashier error" });
    const after = await stockOf(db, ws.tenantId, ws.branchId, ws.productId);
    expect(after).toBe(before);
    const [row] = await db.select().from(sales).where(eq(sales.id, sale.saleId));
    expect(row!.status).toBe("voided");
  });

  it("builds a receipt with real business, branch and payment data", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Receipt Co");
    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
      payments: [{ method: "cash", amount: "2000.00" }],
      idempotencyKey: key(),
    });
    const receipt = await buildReceipt(db, ws.tenantId, sale.saleId);
    expect(receipt?.number).toBe(sale.number);
    expect(receipt?.items).toHaveLength(1);
    expect(receipt?.total).toBe("1075.00");
    expect(receipt?.branchName).toContain("Main");
    expect(receipt?.verifyUrl).toContain("/receipt/");
  });

  it("produces a daily reconciliation by payment method", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Recon Co");
    await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
      payments: [{ method: "cash", amount: "2000.00" }],
      idempotencyKey: key(),
    });
    const recon = await dailyReconciliation(db, ws.tenantId, ws.branchId);
    expect(recon.salesCount).toBeGreaterThanOrEqual(1);
    expect(recon.byMethod.find((m) => m.method === "cash")?.total).toBe("2000.00");
  });

  it("rejects unknown products belonging to another tenant", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "Tenant A Sales");
    const b = await createWorkspace(db, "Tenant B Sales");
    await expect(
      createSale(a.ctx, {
        branchId: a.branchId,
        items: [{ productId: b.productId, name: "Foreign", quantity: "1.000" }],
        payments: [{ method: "cash", amount: "1000.00" }],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it("refuses to sell into another tenant's branch", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "BranchGuard A");
    const b = await createWorkspace(db, "BranchGuard B");
    await expect(
      createSale(a.ctx, {
        branchId: b.branchId,
        items: [{ productId: a.productId, name: "Test Rice", quantity: "1.000" }],
        payments: [{ method: "cash", amount: "2000.00" }],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("counts each sale exactly once in aggregates", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Count Co");
    const sale = await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "2.000" }],
      payments: [{ method: "cash", amount: "3000.00" }],
      idempotencyKey: key(),
    });
    const nRows = (await db.execute(sql`select count(*)::int as n from sales where tenant_id = ${ws.tenantId}`)).rows as { n: number }[];
    expect(nRows[0]!.n).toBe(1);
    const refundRows = (await db.execute(sql`select count(*)::int as n from refunds where tenant_id = ${ws.tenantId}`)).rows as { n: number }[];
    expect(refundRows[0]!.n).toBe(0);
    void sale;
    void refunds;
    void computeCart;
  });
});
