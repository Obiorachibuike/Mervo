import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import {
  auditLogs,
  branches,
  businesses,
  cashDrawerSessions,
  customers,
  payments as paymentsTable,
  products,
  refunds as refundsTable,
  saleItems,
  sales,
  stockLevels,
  suspendedCarts,
} from "@/server/db/schema";
import type { Db, DbLike } from "@/server/db";
import { add, allocate, fromMinor, gt, gte as moneyGte, isZero, lt as moneyLt, money, multiply, percentOf, sub, sum, taxPortionOf, toMinor } from "@/server/lib/money";
import { addQty, fromQty, toQty } from "@/server/lib/money";
import { applyStockMovement, assertBranch, InsufficientStockError } from "./inventory";
import { postJournal, refundJournalLines, saleJournalLines } from "./finance";

export class SaleValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

/* ────────────────────────────── pure pricing ────────────────────────────── */

export type PricedLineInput = {
  productId?: string | null;
  variantId?: string | null;
  name: string;
  sku?: string | null;
  quantity: string;
  unitPrice: string;
  unitCost?: string;
  discount?: string;
  taxRate?: number;
  modifiers?: { name: string; price: number }[];
};

export type PricedLine = {
  productId: string | null;
  variantId: string | null;
  name: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  gross: string;
  lineDiscount: string;
  orderDiscountShare: string;
  taxable: string;
  taxRate: number;
  taxAmount: string;
  lineTotal: string;
  costTotal: string;
  modifiers: { name: string; price: number }[];
};

export type CartTotals = {
  lines: PricedLine[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  costTotal: string;
  netRevenue: string;
};

/**
 * Deterministic cart pricing.
 *  · line discounts cannot exceed the line value
 *  · order-level discounts are allocated proportionally across lines (and thus tax)
 *  · tax is computed per line at the line's rate, half-up rounded to 2dp
 *  · taxInclusive extracts tax out of the shelf price instead of adding it
 */
export function computeCart(input: {
  lines: PricedLineInput[];
  orderDiscount?: string;
  taxInclusive?: boolean;
}): CartTotals {
  const orderDiscount = money(input.orderDiscount ?? "0");
  const priced = input.lines.map((line) => {
    const gross = multiply(line.quantity, line.unitPrice);
    const modifiersTotal = (line.modifiers ?? []).reduce((acc, m) => add(acc, money(m.price)), "0");
    const grossWithModifiers = add(gross, multiply(line.quantity, modifiersTotal));
    const requestedDiscount = money(line.discount ?? "0");
    const lineDiscount = gt(requestedDiscount, grossWithModifiers) ? grossWithModifiers : requestedDiscount;
    const net = sub(grossWithModifiers, lineDiscount);
    return { line, gross: grossWithModifiers, lineDiscount, net };
  });

  const netTotal = sum(priced.map((p) => p.net));
  if (gt(orderDiscount, netTotal)) throw new SaleValidationError("Order discount cannot exceed the cart total", "orderDiscount");
  const shares = allocate(orderDiscount, priced.map((p) => Math.max(0.0001, Number(p.net))));

  const lines: PricedLine[] = priced.map((p, index) => {
    const share = shares[index] ?? "0.00";
    const afterAllDiscounts = sub(p.net, share);
    const rate = p.line.taxRate ?? 0;
    let taxable: string;
    let taxAmount: string;
    if (input.taxInclusive && rate > 0) {
      const tax = taxPortionOf(afterAllDiscounts, String(rate));
      taxable = sub(afterAllDiscounts, tax);
      taxAmount = tax;
    } else {
      taxable = afterAllDiscounts;
      taxAmount = rate > 0 ? percentOf(taxable, String(rate)) : "0.00";
    }
    const costTotal = multiply(p.line.quantity, p.line.unitCost ?? "0");
    return {
      productId: p.line.productId ?? null,
      variantId: p.line.variantId ?? null,
      name: p.line.name,
      sku: p.line.sku ?? null,
      quantity: fromQty(toQty(p.line.quantity)),
      unitPrice: money(p.line.unitPrice),
      unitCost: money(p.line.unitCost ?? "0"),
      gross: p.gross,
      lineDiscount: p.lineDiscount,
      orderDiscountShare: share,
      taxable,
      taxRate: rate,
      taxAmount,
      lineTotal: add(taxable, taxAmount),
      costTotal,
      modifiers: p.line.modifiers ?? [],
    };
  });

  return {
    lines,
    subtotal: sum(lines.map((l) => l.gross)),
    discountTotal: sum(lines.map((l) => add(l.lineDiscount, l.orderDiscountShare))),
    taxTotal: sum(lines.map((l) => l.taxAmount)),
    total: sum(lines.map((l) => l.lineTotal)),
    costTotal: sum(lines.map((l) => l.costTotal)),
    netRevenue: sum(lines.map((l) => l.taxable)),
  };
}

/* ───────────────────────────── sale creation ────────────────────────────── */

/** POS payload: the server resolves name/price/cost from the product record. */
export type CreateSaleItemInput = {
  productId?: string | null;
  variantId?: string | null;
  name?: string;
  sku?: string | null;
  quantity: string;
  unitPrice?: string;
  unitCost?: string;
  discount?: string;
  taxRate?: number;
  modifiers?: { name: string; price: number }[];
};

export type CreateSaleInput = {
  branchId: string;
  customerId?: string | null;
  items: CreateSaleItemInput[];
  payments: { method: "cash" | "card" | "transfer" | "paystack" | "flutterwave" | "stripe" | "credit" | "terminal"; amount: string; reference?: string }[];
  orderDiscount?: string;
  notes?: string | null;
  idempotencyKey: string;
  source?: "pos" | "storefront" | "offline_sync" | "restaurant";
  taxInclusive?: boolean;
  offlineCreatedAt?: Date | null;
  registerId?: string | null;
  receiptEmail?: string | null;
  /** Backdating for imports/seeding. Never sent by the POS itself. */
  soldAt?: Date | null;
  /**
   * Storefront checkout collects payment after dispatch, so the receivable is
   * expected. POS credit sales keep the hard credit-limit check.
   */
  enforceCreditLimit?: boolean;
};

export type SaleResult = {
  saleId: string;
  number: string;
  total: string;
  paidTotal: string;
  changeDue: string;
  balanceDue: string;
  duplicate: boolean;
  createdAt: Date;
};

const METHOD_ACCOUNT_HINT = (method: string) =>
  ["transfer", "card", "paystack", "flutterwave", "stripe", "terminal"].includes(method) ? method : "cash";

async function nextSaleNumber(db: DbLike, tenantId: string, when = new Date()): Promise<string> {
  const startOfDay = new Date(when);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.createdAt, startOfDay), lt(sales.createdAt, endOfDay)));
  const stamp = startOfDay.toISOString().slice(2, 10).replace(/-/g, "");
  return `INV-${stamp}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Creates a sale atomically:
 *   idempotency check → price → stock ledger → sale rows → double-entry journal
 *   → customer/CRM rollups → audit trail.
 * Replaying the same idempotency key returns the original sale (never duplicates).
 */
export async function createSale(
  ctx: { db: Db; tenantId: string; userId: string; permissions: string[] },
  input: CreateSaleInput,
): Promise<SaleResult> {
  if (!input.items.length) throw new SaleValidationError("Cart is empty");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new SaleValidationError("Missing idempotency key");
  if (input.payments.some((p) => moneyLt(p.amount, "0"))) throw new SaleValidationError("Payment amount cannot be negative");

  return ctx.db.transaction(async (tx) => {
    // 1 — idempotency (unique index on tenant + key is the real guard)
    const [existing] = await tx
      .select({ id: sales.id, number: sales.number, total: sales.total, paidTotal: sales.paidTotal, changeDue: sales.changeDue, balanceDue: sales.balanceDue, createdAt: sales.createdAt })
      .from(sales)
      .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) return { ...existing, saleId: existing.id, duplicate: true };

    await assertBranch(tx, ctx.tenantId, input.branchId);

    // 2 — resolve products within the tenant only
    const productIds = input.items.map((i) => i.productId).filter((id): id is string => Boolean(id));
    const productRows = productIds.length
      ? await tx
          .select()
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), sql`${products.id} in (${sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `)})`))
      : [];
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const [business] = await tx.select().from(businesses).where(eq(businesses.tenantId, ctx.tenantId)).limit(1);
    const taxInclusive = input.taxInclusive ?? business?.taxInclusive ?? false;

    const lines: PricedLineInput[] = input.items.map((item) => {
      if (item.productId) {
        const product = productMap.get(item.productId);
        if (!product) throw new SaleValidationError("One of the products no longer exists", "items");
        const useCustomPrice = item.unitPrice !== undefined && money(item.unitPrice) !== money(product.price);
        if (useCustomPrice && !ctx.permissions.includes("sales.discount") && !ctx.permissions.includes("*")) {
          throw new SaleValidationError("You are not allowed to change prices", "items");
        }
        return {
          productId: product.id,
          variantId: item.variantId ?? null,
          name: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? product.price,
          unitCost: product.costPrice,
          discount: item.discount ?? "0",
          taxRate: item.taxRate ?? (Number(product.taxRate) || Number(business?.taxRate ?? 0)),
          modifiers: item.modifiers,
        };
      }
      if (!item.name) throw new SaleValidationError("Custom line items need a name", "items");
      if (item.unitPrice === undefined) throw new SaleValidationError("Custom line items need a price", "items");
      return {
        productId: null,
        variantId: item.variantId ?? null,
        name: item.name,
        sku: item.sku ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost ?? "0",
        discount: item.discount ?? "0",
        taxRate: item.taxRate ?? Number(business?.taxRate ?? 0),
        modifiers: item.modifiers,
      };
    });

    if (input.orderDiscount && gt(input.orderDiscount, "0") && !ctx.permissions.includes("sales.discount") && !ctx.permissions.includes("*")) {
      throw new SaleValidationError("You are not allowed to apply order discounts", "orderDiscount");
    }

    const totals = computeCart({ lines, orderDiscount: input.orderDiscount, taxInclusive });

    // 3 — payments & credit rules
    const cashPaid = sum(input.payments.filter((p) => p.method !== "credit").map((p) => p.amount));
    const balanceDue = gt(totals.total, cashPaid) ? sub(totals.total, cashPaid) : "0.00";
    const changeDue = gt(cashPaid, totals.total) ? sub(cashPaid, totals.total) : "0.00";
    if (gt(balanceDue, "0") && !input.customerId) {
      throw new SaleValidationError("Credit sales require a customer", "customerId");
    }
    if (gt(balanceDue, "0") && input.customerId && input.enforceCreditLimit !== false) {
      const [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
        .limit(1);
      if (!customer) throw new SaleValidationError("Customer not found", "customerId");
      const projected = add(customer.balanceOwed, balanceDue);
      if (gt(projected, customer.creditLimit)) {
        throw new SaleValidationError(`Credit limit exceeded (limit ${customer.creditLimit}, outstanding ${customer.balanceOwed})`, "customerId");
      }
    }

    // 5 — sale header
    const number = await nextSaleNumber(tx, ctx.tenantId, input.soldAt ?? new Date());
    const primaryMethod = input.payments.length
      ? input.payments.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a)).method
      : "cash";
    const [sale] = await tx
      .insert(sales)
      .values({
        tenantId: ctx.tenantId,
        branchId: input.branchId,
        number,
        customerId: input.customerId ?? null,
        createdBy: ctx.userId,
        registerId: input.registerId ?? null,
        status: "completed",
        source: input.source ?? "pos",
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        costTotal: totals.costTotal,
        paidTotal: cashPaid,
        changeDue,
        balanceDue,
        currency: business?.currency ?? "NGN",
        paymentStatus: isZero(balanceDue) ? "paid" : isZero(cashPaid) ? "unpaid" : "partial",
        idempotencyKey: input.idempotencyKey,
        offlineCreatedAt: input.offlineCreatedAt ?? null,
        notes: input.notes ?? null,
        receiptEmail: input.receiptEmail ?? null,
        completedAt: input.soldAt ?? new Date(),
        createdAt: input.soldAt ?? undefined,
      })
      .returning({ id: sales.id, number: sales.number, createdAt: sales.createdAt });

    await tx.insert(saleItems).values(
      totals.lines.map((l) => ({
        tenantId: ctx.tenantId,
        saleId: sale!.id,
        productId: l.productId,
        variantId: l.variantId,
        name: l.name,
        sku: l.sku,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        discount: add(l.lineDiscount, l.orderDiscountShare),
        taxRate: String(l.taxRate),
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
        modifiers: l.modifiers,
      })),
    );

    // stock ledger — atomic deduction, negative stock blocked, linked to the sale
    for (const line of totals.lines) {
      if (!line.productId) continue;
      const product = productMap.get(line.productId);
      if (!product || !product.trackStock) continue;
      try {
        await applyStockMovement(tx, {
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          productId: line.productId,
          variantId: line.variantId,
          type: "sale",
          quantityDelta: `-${line.quantity}`,
          unitCost: line.unitCost,
          referenceType: "sale",
          referenceId: sale!.id,
          createdBy: ctx.userId,
        });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          throw new SaleValidationError(`${line.name} is out of stock (available ${error.available})`, "items");
        }
        throw error;
      }
    }

    if (input.payments.length) {
      await tx.insert(paymentsTable).values(
        input.payments.map((p) => ({
          tenantId: ctx.tenantId,
          saleId: sale!.id,
          method: p.method,
          amount: money(p.amount),
          currency: business?.currency ?? "NGN",
          status: "succeeded" as const,
          reference: p.reference ?? null,
          idempotencyKey: `${input.idempotencyKey}:${p.method}:${p.amount}`.slice(0, 120),
          createdBy: ctx.userId,
        })),
      );
    }

    // 6 — ledger
    await postJournal(tx, {
      tenantId: ctx.tenantId,
      branchId: input.branchId,
      memo: `Sale ${sale!.number}`,
      referenceType: "sale",
      referenceId: sale!.id,
      createdBy: ctx.userId,
      currency: business?.currency ?? "NGN",
      date: input.soldAt ?? new Date(),
      lines: saleJournalLines({
        total: totals.total,
        taxTotal: totals.taxTotal,
        netRevenue: totals.netRevenue,
        costTotal: totals.costTotal,
        paidTotal: cashPaid,
        method: METHOD_ACCOUNT_HINT(primaryMethod),
      }),
    });

    // 7 — CRM rollups
    if (input.customerId) {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
      if (customer) {
        const points = Math.floor(Number(totals.total) / 100);
        await tx
          .update(customers)
          .set({
            totalSpent: add(customer.totalSpent, totals.total),
            orderCount: customer.orderCount + 1,
            lastPurchaseAt: new Date(),
            balanceOwed: add(customer.balanceOwed, balanceDue),
            loyaltyPoints: customer.loyaltyPoints + points,
            segment: "active",
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customer.id));
      }
    }

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "sale.create",
      entity: "sale",
      entityId: sale!.id,
      severity: "info",
      metadata: { number: sale!.number, total: totals.total, source: input.source ?? "pos", itemCount: totals.lines.length },
    });

    return {
      saleId: sale!.id,
      number: sale!.number,
      total: totals.total,
      paidTotal: cashPaid,
      changeDue,
      balanceDue,
      duplicate: false,
      createdAt: sale!.createdAt,
    };
  });
}

/* ─────────────────────────────── refunds ────────────────────────────────── */

export async function refundSale(
  ctx: { db: Db; tenantId: string; userId: string; permissions: string[] },
  input: {
    saleId: string;
    items?: { saleItemId: string; quantity: string }[];
    reason?: string;
    method?: "cash" | "card" | "transfer";
    restock?: boolean;
    /** Internal: backdate a refund during imports/seeding. */
    refundedAt?: Date | null;
  },
) {
  return ctx.db.transaction(async (tx) => {
    const [sale] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .for("update")
      .limit(1);
    if (!sale) throw new SaleValidationError("Sale not found");
    if (sale.status === "voided") throw new SaleValidationError("Cannot refund a voided sale");

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const requested = input.items?.length
      ? input.items
      : items
          .map((i) => ({ saleItemId: i.id, quantity: fromQty(toQty(i.quantity) - toQty(i.refundedQty)) }))
          .filter((i) => toQty(i.quantity) > 0n);

    if (!requested.length) throw new SaleValidationError("Nothing left to refund on this sale");

    let refundAmount = "0.00";
    let costReversal = "0.00";
    for (const req of requested) {
      const item = items.find((i) => i.id === req.saleItemId);
      if (!item) throw new SaleValidationError("Refund line not found on this sale");
      const remaining = fromQty(toQty(item.quantity) - toQty(item.refundedQty));
      if (toQty(req.quantity) > toQty(remaining)) throw new SaleValidationError(`Cannot refund more than ${remaining} of ${item.name}`);
      const unitValue = Number(item.lineTotal) / Math.max(1, Number(item.quantity));
      const lineRefund = money((unitValue * Number(req.quantity)).toFixed(2));
      refundAmount = add(refundAmount, lineRefund);
      costReversal = add(costReversal, multiply(req.quantity, item.unitCost));

      if (item.productId && input.restock !== false) {
        await applyStockMovement(tx, {
          tenantId: ctx.tenantId,
          branchId: sale.branchId,
          productId: item.productId,
          variantId: item.variantId,
          type: "refund",
          quantityDelta: req.quantity,
          unitCost: item.unitCost,
          referenceType: "refund",
          referenceId: sale.id,
          createdBy: ctx.userId,
          reason: input.reason ?? "Customer return",
        });
      }
      await tx
        .update(saleItems)
        .set({ refundedQty: fromQty(toQty(item.refundedQty) + toQty(req.quantity)) })
        .where(eq(saleItems.id, item.id));
    }

    if (gt(refundAmount, sale.total)) refundAmount = money(sale.total);

    const [refund] = await tx
      .insert(refundsTable)
      .values({
        tenantId: ctx.tenantId,
        saleId: sale.id,
        amount: refundAmount,
        reason: input.reason ?? null,
        method: input.method ?? "cash",
        restock: input.restock !== false,
        items: requested,
        status: "approved",
        approvedBy: ctx.userId,
        createdBy: ctx.userId,
        ...(input.refundedAt ? { createdAt: input.refundedAt } : {}),
      })
      .returning({ id: refundsTable.id });

    const remainingQty = await tx
      .select({ total: sql<string>`coalesce(sum(${saleItems.quantity} - ${saleItems.refundedQty}), 0)::text` })
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id));
    const fullyRefunded = Number(remainingQty[0]?.total ?? "0") <= 0;

    await tx
      .update(sales)
      .set({
        status: fullyRefunded ? "refunded" : "partially_refunded",
        paymentStatus: "refunded",
        balanceDue: "0.00",
      })
      .where(eq(sales.id, sale.id));

    await postJournal(tx, {
      tenantId: ctx.tenantId,
      branchId: sale.branchId,
      memo: `Refund ${sale.number}`,
      referenceType: "refund",
      referenceId: refund!.id,
      createdBy: ctx.userId,
      date: input.refundedAt ?? new Date(),
      lines: refundJournalLines({
        amount: refundAmount,
        taxPortion: "0.00",
        costPortion: costReversal,
        method: input.method ?? "cash",
      }),
    });

    if (sale.customerId) {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1);
      if (customer) {
        await tx
          .update(customers)
          .set({ totalSpent: sub(customer.totalSpent, refundAmount), updatedAt: new Date() })
          .where(eq(customers.id, customer.id));
      }
    }

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "sale.refund",
      entity: "sale",
      entityId: sale.id,
      severity: "warning",
      metadata: { amount: refundAmount, reason: input.reason ?? null, fullyRefunded },
    });

    return { refundId: refund!.id, amount: refundAmount, fullyRefunded };
  });
}

export async function voidSale(ctx: { db: Db; tenantId: string; userId: string }, input: { saleId: string; reason: string }) {
  return ctx.db.transaction(async (tx) => {
    const [sale] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .for("update")
      .limit(1);
    if (!sale) throw new SaleValidationError("Sale not found");
    if (sale.status === "voided") return { alreadyVoided: true };
    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    for (const item of items) {
      if (!item.productId) continue;
      const restockQty = fromQty(toQty(item.quantity) - toQty(item.refundedQty));
      if (toQty(restockQty) <= 0n) continue;
      await applyStockMovement(tx, {
        tenantId: ctx.tenantId,
        branchId: sale.branchId,
        productId: item.productId,
        variantId: item.variantId,
        type: "refund",
        quantityDelta: restockQty,
        unitCost: item.unitCost,
        referenceType: "void",
        referenceId: sale.id,
        createdBy: ctx.userId,
        reason: input.reason,
      });
    }
    await tx.update(sales).set({ status: "voided", balanceDue: "0.00" }).where(eq(sales.id, sale.id));
    await postJournal(tx, {
      tenantId: ctx.tenantId,
      branchId: sale.branchId,
      memo: `Void ${sale.number} — ${input.reason}`,
      referenceType: "void",
      referenceId: sale.id,
      createdBy: ctx.userId,
      lines: refundJournalLines({ amount: sale.paidTotal, taxPortion: "0.00", costPortion: sale.costTotal, method: "cash" }),
    });
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "sale.void",
      entity: "sale",
      entityId: sale.id,
      severity: "critical",
      metadata: { reason: input.reason },
    });
    return { alreadyVoided: false };
  });
}

/* ─────────────────────── suspend, drawer, receipts ──────────────────────── */

export async function suspendCart(
  ctx: { db: Db; tenantId: string; userId: string },
  input: { branchId: string; label: string; cart: unknown },
) {
  const [row] = await ctx.db
    .insert(suspendedCarts)
    .values({ tenantId: ctx.tenantId, branchId: input.branchId, label: input.label, cart: input.cart, createdBy: ctx.userId })
    .returning({ id: suspendedCarts.id });
  return row!;
}

export async function openCashDrawer(ctx: { db: Db; tenantId: string; userId: string }, input: { branchId: string; openingFloat: string }) {
  const [row] = await ctx.db
    .insert(cashDrawerSessions)
    .values({
      tenantId: ctx.tenantId,
      branchId: input.branchId,
      openedBy: ctx.userId,
      openingFloat: money(input.openingFloat),
      status: "open",
    })
    .returning();
  return row!;
}

export async function closeCashDrawer(
  ctx: { db: Db; tenantId: string; userId: string },
  input: { sessionId: string; closingCount: string },
) {
  return ctx.db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(cashDrawerSessions)
      .where(and(eq(cashDrawerSessions.id, input.sessionId), eq(cashDrawerSessions.tenantId, ctx.tenantId)))
      .for("update")
      .limit(1);
    if (!session) throw new SaleValidationError("Drawer session not found");
    const cashRows = await tx
      .select({ total: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)::text` })
      .from(paymentsTable)
      .innerJoin(sales, eq(sales.id, paymentsTable.saleId))
      .where(
        and(
          eq(paymentsTable.tenantId, ctx.tenantId),
          eq(paymentsTable.method, "cash"),
          eq(sales.branchId, session.branchId),
          gte(paymentsTable.createdAt, session.openedAt),
        ),
      );
    const cashSales = money(cashRows[0]?.total ?? "0");
    const expected = add(session.openingFloat, cashSales);
    const variance = sub(money(input.closingCount), expected);
    await tx
      .update(cashDrawerSessions)
      .set({ closingCount: money(input.closingCount), expectedCash: expected, variance, status: "closed", closedAt: new Date(), closedBy: ctx.userId })
      .where(eq(cashDrawerSessions.id, session.id));
    return { expected, counted: money(input.closingCount), variance, cashSales };
  });
}

export async function dailyReconciliation(db: DbLike, tenantId: string, branchId: string, day = new Date()) {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const rows = await db
    .select({
      method: paymentsTable.method,
      total: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(paymentsTable)
    .innerJoin(sales, eq(sales.id, paymentsTable.saleId))
    .where(
      and(
        eq(paymentsTable.tenantId, tenantId),
        eq(sales.branchId, branchId),
        gte(paymentsTable.createdAt, start),
        lte(paymentsTable.createdAt, end),
      ),
    )
    .groupBy(paymentsTable.method);
  const salesRows = await db
    .select({
      count: sql<number>`count(*)::int`,
      gross: sql<string>`coalesce(sum(${sales.total}), 0)::text`,
      tax: sql<string>`coalesce(sum(${sales.taxTotal}), 0)::text`,
    })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.branchId, branchId), gte(sales.createdAt, start), lte(sales.createdAt, end), eq(sales.status, "completed")));
  return {
    day: start,
    byMethod: rows.map((r) => ({ method: r.method, total: money(r.total), count: r.count })),
    salesCount: salesRows[0]?.count ?? 0,
    gross: money(salesRows[0]?.gross ?? "0"),
    tax: money(salesRows[0]?.tax ?? "0"),
  };
}

export type Receipt = {
  tenantName: string;
  businessName: string;
  address: string | null;
  phone: string | null;
  branchName: string;
  number: string;
  createdAt: Date;
  cashier: string;
  customerName: string | null;
  items: { name: string; quantity: string; unitPrice: string; lineTotal: string; modifiers: { name: string; price: number }[] }[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  paidTotal: string;
  changeDue: string;
  balanceDue: string;
  currency: string;
  payments: { method: string; amount: string }[];
  footer: string | null;
  verifyUrl: string;
};

export async function buildReceipt(db: DbLike, tenantId: string, saleId: string): Promise<Receipt | null> {
  const [row] = await db
    .select({ sale: sales, business: businesses, branch: branches })
    .from(sales)
    .innerJoin(businesses, eq(businesses.tenantId, sales.tenantId))
    .innerJoin(branches, eq(branches.id, sales.branchId))
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));
  const pays = await db.select().from(paymentsTable).where(eq(paymentsTable.saleId, saleId));
  let customerName: string | null = null;
  if (row.sale.customerId) {
    const [c] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, row.sale.customerId));
    customerName = c?.name ?? null;
  }
  return {
    tenantName: row.business.name,
    businessName: row.business.name,
    address: row.business.address,
    phone: row.business.phone,
    branchName: row.branch.name,
    number: row.sale.number,
    createdAt: row.sale.createdAt,
    cashier: "",
    customerName,
    items: items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      modifiers: i.modifiers ?? [],
    })),
    subtotal: row.sale.subtotal,
    discountTotal: row.sale.discountTotal,
    taxTotal: row.sale.taxTotal,
    total: row.sale.total,
    paidTotal: row.sale.paidTotal,
    changeDue: row.sale.changeDue,
    balanceDue: row.sale.balanceDue,
    currency: row.sale.currency,
    payments: pays.map((p) => ({ method: p.method, amount: p.amount })),
    footer: row.business.receiptFooter,
    verifyUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/receipt/${row.sale.id}`,
  };
}

export async function recentSales(db: DbLike, tenantId: string, opts: { branchId?: string; limit?: number; search?: string } = {}) {
  const conditions = [eq(sales.tenantId, tenantId)];
  if (opts.branchId) conditions.push(eq(sales.branchId, opts.branchId));
  if (opts.search) conditions.push(sql`(${sales.number} ilike ${`%${opts.search}%`})`);
  return db
    .select({
      id: sales.id,
      number: sales.number,
      total: sales.total,
      status: sales.status,
      paymentStatus: sales.paymentStatus,
      source: sales.source,
      createdAt: sales.createdAt,
      balanceDue: sales.balanceDue,
      branchName: branches.name,
      customerName: customers.name,
    })
    .from(sales)
    .leftJoin(branches, eq(branches.id, sales.branchId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(opts.limit ?? 50);
}

export { stockLevels, isNull, lte, addQty, toMinor, moneyGte, fromMinor };
