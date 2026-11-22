import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { boot, createWorkspace, addMember } from "./harness";
import { buildReceipt, createSale, recentSales } from "@/server/services/sales";
import { listCustomers } from "@/server/services/crm";
import { branchPerformance, salesSummary, rangeFromDays } from "@/server/services/reports";
import { executeTool } from "@/server/ai/tools";
import { trialBalance } from "@/server/services/finance";

const key = () => `iso-${Math.random().toString(36).slice(2)}`;

describe("tenant isolation", () => {
  it("never returns another tenant's sales, customers or reports", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "Isolation A");
    const b = await createWorkspace(db, "Isolation B");
    await createSale(a.ctx, {
      branchId: a.branchId,
      items: [{ productId: a.productId, name: "Test Rice", quantity: "2.000" }],
      payments: [{ method: "cash", amount: "5000.00" }],
      idempotencyKey: key(),
    });
    await createSale(b.ctx, {
      branchId: b.branchId,
      items: [{ productId: b.productId, name: "Test Rice", quantity: "1.000" }],
      payments: [{ method: "cash", amount: "3000.00" }],
      idempotencyKey: key(),
    });

    const aSales = await recentSales(db, a.tenantId);
    expect(aSales).toHaveLength(1);
    expect(aSales[0]!.total).toBe("2150.00");
    const bSales = await recentSales(db, b.tenantId);
    expect(bSales).toHaveLength(1);
    expect(bSales[0]!.total).toBe("1075.00");

    const aCustomers = await listCustomers(db, a.tenantId);
    expect(aCustomers.every((c) => c.tenantId === a.tenantId)).toBe(true);
    expect(aCustomers.find((c) => c.id === b.customerId)).toBeUndefined();

    const aSummary = await salesSummary(db, a.tenantId, rangeFromDays(1));
    const bSummary = await salesSummary(db, b.tenantId, rangeFromDays(1));
    expect(aSummary.count).toBe(1);
    expect(bSummary.count).toBe(1);
    expect(aSummary.gross).not.toBe(bSummary.gross);
  });

  it("cannot read a sale receipt from another tenant", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "Receipt A");
    const b = await createWorkspace(db, "Receipt B");
    const saleB = await createSale(b.ctx, {
      branchId: b.branchId,
      items: [{ productId: b.productId, name: "Test Rice", quantity: "1.000" }],
      payments: [{ method: "cash", amount: "2000.00" }],
      idempotencyKey: key(),
    });
    expect(await buildReceipt(db, a.tenantId, saleB.saleId)).toBeNull();
    expect((await buildReceipt(db, b.tenantId, saleB.saleId))?.number).toBe(saleB.number);
  });

  it("reports branch performance only for the calling tenant", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "BranchPerf A");
    const b = await createWorkspace(db, "BranchPerf B");
    const rows = await branchPerformance(db, a.tenantId, rangeFromDays(30));
    expect(rows.every((r) => ["Main", "Second"].some((n) => r.name.includes(n)))).toBe(true);
    expect(rows.find((r) => r.branchId === b.branchId)).toBeUndefined();
  });

  it("keeps each tenant's ledger separate and balanced", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "LedgerIso A");
    const b = await createWorkspace(db, "LedgerIso B");
    for (const ws of [a, b]) {
      await createSale(ws.ctx, {
        branchId: ws.branchId,
        items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
        payments: [{ method: "cash", amount: "2000.00" }],
        idempotencyKey: key(),
      });
    }
    for (const ws of [a, b]) {
      const tb = await trialBalance(db, ws.tenantId);
      expect(tb.balanced).toBe(true);
      expect(tb.rows.every((r) => Number(r.debit) >= 0)).toBe(true);
    }
    const nRows = (await db.execute(sql`select count(distinct tenant_id)::int as n from journal_entries where tenant_id in (${a.tenantId}, ${b.tenantId})`)).rows as { n: number }[];
    expect(nRows[0]!.n).toBe(2);
  });

  it("blocks AI tools for users without the permission", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "ToolPerm Co");
    await createSale(ws.ctx, {
      branchId: ws.branchId,
      items: [{ productId: ws.productId, name: "Test Rice", quantity: "1.000" }],
      payments: [{ method: "cash", amount: "2000.00" }],
      idempotencyKey: key(),
    });
    const cashier = await addMember(db, ws.tenantId, "cashier");
    const forbidden = (await executeTool(
      { db, tenantId: ws.tenantId, userId: cashier.userId, permissions: cashier.permissions, currency: "NGN" },
      "get_profit_summary",
      { days: 30 },
    )) as { error?: string };
    expect(forbidden.error).toMatch(/permission/i);

    const allowed = (await executeTool(
      { db, tenantId: ws.tenantId, userId: ws.ownerId, permissions: ["*"], currency: "NGN" },
      "get_profit_summary",
      { days: 30 },
    )) as { revenue?: string; basis?: string };
    expect(allowed.basis).toBe("actual");
    expect(Number(allowed.revenue)).toBeGreaterThan(0);
  });

  it("scopes AI tool results to the calling tenant", async () => {
    const db = await boot();
    const a = await createWorkspace(db, "ToolScope A");
    const b = await createWorkspace(db, "ToolScope B");
    await createSale(a.ctx, {
      branchId: a.branchId,
      items: [{ productId: a.productId, name: "Test Rice", quantity: "2.000" }],
      payments: [{ method: "cash", amount: "5000.00" }],
      idempotencyKey: key(),
    });
    const aResult = (await executeTool({ db, tenantId: a.tenantId, userId: a.ownerId, permissions: ["*"], currency: "NGN" }, "get_sales_summary", { days: 1 })) as { grossSales: string };
    const bResult = (await executeTool({ db, tenantId: b.tenantId, userId: b.ownerId, permissions: ["*"], currency: "NGN" }, "get_sales_summary", { days: 1 })) as { grossSales: string };
    expect(Number(aResult.grossSales)).toBe(2150);
    expect(Number(bResult.grossSales)).toBe(0);
  });

  it("marks forecasts as estimates, never actuals", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Estimate Co");
    const result = (await executeTool({ db, tenantId: ws.tenantId, userId: ws.ownerId, permissions: ["reports.view"], currency: "NGN" }, "forecast_sales", { horizonDays: 7 })) as { basis: string };
    expect(result.basis).toBe("estimate");
  });
});
