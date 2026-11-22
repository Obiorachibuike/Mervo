import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { customers, sales, saleItems } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { money, sub } from "@/server/lib/money";

export async function listCustomers(db: DbLike, tenantId: string, opts: { search?: string; limit?: number } = {}) {
  const conditions = [eq(customers.tenantId, tenantId)];
  if (opts.search) {
    const term = `%${opts.search.toLowerCase()}%`;
    conditions.push(
      or(sql`lower(${customers.name}) like ${term}`, sql`lower(coalesce(${customers.email}, '')) like ${term}`, sql`coalesce(${customers.phone}, '') like ${term}`)!,
    );
  }
  return db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(desc(customers.totalSpent))
    .limit(opts.limit ?? 100);
}

export async function createCustomer(db: DbLike, tenantId: string, input: { name: string; email?: string | null; phone?: string | null; address?: string | null; creditLimit?: string; marketingConsent?: boolean; whatsappConsent?: boolean; notes?: string | null }) {
  const [row] = await db
    .insert(customers)
    .values({
      tenantId,
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      address: input.address || null,
      creditLimit: money(input.creditLimit ?? "0"),
      marketingConsent: input.marketingConsent ?? false,
      whatsappConsent: input.whatsappConsent ?? false,
      notes: input.notes || null,
    })
    .returning();
  return row!;
}

export async function customerHistory(db: DbLike, tenantId: string, customerId: string) {
  const rows = await db
    .select({ id: sales.id, number: sales.number, total: sales.total, status: sales.status, createdAt: sales.createdAt, balanceDue: sales.balanceDue })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.customerId, customerId)))
    .orderBy(desc(sales.createdAt))
    .limit(50);
  const favourites = await db
    .select({ name: saleItems.name, units: sql<string>`sum(${saleItems.quantity})::text` })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(eq(sales.tenantId, tenantId), eq(sales.customerId, customerId)))
    .groupBy(saleItems.name)
    .orderBy(desc(sql`sum(${saleItems.quantity})`))
    .limit(5);
  return { sales: rows, favourites };
}

export async function recordPaymentOnAccount(
  db: DbLike,
  tenantId: string,
  input: { customerId: string; amount: string },
) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  if (!customer) throw new Error("Customer not found");
  const next = sub(customer.balanceOwed, money(input.amount));
  await db
    .update(customers)
    .set({ balanceOwed: Number(next) < 0 ? "0.00" : next, updatedAt: new Date() })
    .where(eq(customers.id, customer.id));
  return { balanceOwed: Number(next) < 0 ? "0.00" : next };
}

/** Refreshes lifecycle segments from real purchase recency. */
export async function recalculateSegments(db: DbLike, tenantId: string) {
  const now = Date.now();
  const rows = await db.select().from(customers).where(eq(customers.tenantId, tenantId));
  let updated = 0;
  for (const c of rows) {
    const days = c.lastPurchaseAt ? (now - c.lastPurchaseAt.getTime()) / 86400000 : Infinity;
    const segment = !c.lastPurchaseAt ? "new" : days > 90 ? "inactive" : days > 30 ? "at_risk" : c.orderCount >= 5 ? "loyal" : "active";
    if (segment !== c.segment) {
      await db.update(customers).set({ segment, updatedAt: new Date() }).where(eq(customers.id, c.id));
      updated++;
    }
  }
  return { updated };
}

export async function customersWithRecentSales(db: DbLike, tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const [agg] = await db
    .select({ total: sql<string>`coalesce(sum(${sales.total}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.createdAt, since), lte(sales.createdAt, new Date())));
  return { total: money(agg?.total ?? "0"), count: agg?.count ?? 0 };
}
