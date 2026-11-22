import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { kitchenOrders, menuItems, menus, products, reservations, restaurantTables } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { money } from "@/server/lib/money";

export async function tables(db: DbLike, tenantId: string, branchId?: string) {
  const conditions = [eq(restaurantTables.tenantId, tenantId)];
  if (branchId) conditions.push(eq(restaurantTables.branchId, branchId));
  return db.select().from(restaurantTables).where(and(...conditions)).orderBy(asc(restaurantTables.label));
}

export async function setTableStatus(db: DbLike, tenantId: string, tableId: string, status: "free" | "occupied" | "reserved" | "cleaning") {
  const [row] = await db
    .update(restaurantTables)
    .set({ status })
    .where(and(eq(restaurantTables.id, tableId), eq(restaurantTables.tenantId, tenantId)))
    .returning();
  return row;
}

export async function menu(db: DbLike, tenantId: string, branchId?: string) {
  const conditions = [eq(menus.tenantId, tenantId), eq(menus.isActive, true)];
  if (branchId) conditions.push(eq(menus.branchId, branchId));
  const menuRows = await db.select().from(menus).where(and(...conditions));
  if (!menuRows.length) return { menus: [], items: [] };
  const items = await db
    .select({
      id: menuItems.id,
      menuId: menuItems.menuId,
      productId: menuItems.productId,
      price: menuItems.price,
      station: menuItems.station,
      modifiers: menuItems.modifiers,
      recipe: menuItems.recipe,
      isAvailable: menuItems.isAvailable,
      name: products.name,
      description: products.description,
      sku: products.sku,
      categoryId: products.categoryId,
    })
    .from(menuItems)
    .innerJoin(products, eq(products.id, menuItems.productId))
    .where(eq(menuItems.tenantId, tenantId));
  return { menus: menuRows, items };
}

export async function createMenuItem(db: DbLike, tenantId: string, input: { menuId: string; productId: string; price: string; station?: string; modifiers?: { name: string; price: string }[]; recipe?: { productId: string; quantity: string }[] }) {
  const [row] = await db
    .insert(menuItems)
    .values({
      tenantId,
      menuId: input.menuId,
      productId: input.productId,
      price: money(input.price),
      station: input.station ?? "kitchen",
      modifiers: input.modifiers ?? [],
      recipe: input.recipe ?? [],
    })
    .returning();
  return row!;
}

export async function createKitchenOrder(
  db: DbLike,
  input: { tenantId: string; branchId: string; saleId?: string | null; tableId?: string | null; station?: string; items: { name: string; quantity: string; notes?: string }[]; notes?: string },
) {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(kitchenOrders)
    .where(eq(kitchenOrders.tenantId, input.tenantId));
  const [row] = await db
    .insert(kitchenOrders)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      saleId: input.saleId ?? null,
      tableId: input.tableId ?? null,
      ticketNumber: `K-${String(count + 1).padStart(4, "0")}`,
      station: input.station ?? "kitchen",
      items: input.items,
      notes: input.notes ?? null,
    })
    .returning();
  return row!;
}

export async function kitchenQueue(db: DbLike, tenantId: string, station?: string) {
  const conditions = [eq(kitchenOrders.tenantId, tenantId), sql`${kitchenOrders.status} in ('queued','preparing','ready')`];
  if (station) conditions.push(eq(kitchenOrders.station, station));
  return db
    .select({ order: kitchenOrders, tableLabel: restaurantTables.label })
    .from(kitchenOrders)
    .leftJoin(restaurantTables, eq(restaurantTables.id, kitchenOrders.tableId))
    .where(and(...conditions))
    .orderBy(asc(kitchenOrders.createdAt));
}

export async function advanceKitchenOrder(db: DbLike, tenantId: string, orderId: string, status: "preparing" | "ready" | "served" | "cancelled") {
  const patch: Record<string, unknown> = { status };
  if (status === "ready") patch.readyAt = new Date();
  if (status === "served") patch.servedAt = new Date();
  const [row] = await db
    .update(kitchenOrders)
    .set(patch)
    .where(and(eq(kitchenOrders.id, orderId), eq(kitchenOrders.tenantId, tenantId)))
    .returning();
  if (row?.tableId && status === "served") {
    await setTableStatus(db, tenantId, row.tableId, "cleaning");
  }
  return row;
}

export async function reservationsFor(db: DbLike, tenantId: string, days = 2) {
  const from = new Date(Date.now() - 3600 * 1000);
  const to = new Date(Date.now() + days * 86400000);
  return db
    .select({ reservation: reservations, tableLabel: restaurantTables.label })
    .from(reservations)
    .leftJoin(restaurantTables, eq(restaurantTables.id, reservations.tableId))
    .where(and(eq(reservations.tenantId, tenantId), gte(reservations.reservedAt, from)))
    .orderBy(asc(reservations.reservedAt))
    .limit(50)
    .then((rows) => rows.filter((r) => r.reservation.reservedAt <= to));
}

export async function createReservation(
  db: DbLike,
  tenantId: string,
  input: { branchId: string; tableId?: string | null; customerName: string; phone?: string | null; partySize: number; reservedAt: Date; notes?: string | null },
) {
  const [row] = await db
    .insert(reservations)
    .values({
      tenantId,
      branchId: input.branchId,
      tableId: input.tableId ?? null,
      customerName: input.customerName,
      phone: input.phone ?? null,
      partySize: input.partySize,
      reservedAt: input.reservedAt,
      notes: input.notes ?? null,
    })
    .returning();
  if (input.tableId) await setTableStatus(db, tenantId, input.tableId, "reserved");
  return row!;
}

export async function restaurantStats(db: DbLike, tenantId: string) {
  const [open] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(kitchenOrders)
    .where(and(eq(kitchenOrders.tenantId, tenantId), sql`${kitchenOrders.status} in ('queued','preparing')`));
  const tableRows = await db.select({ count: sql<number>`count(*)::int`, occupied: sql<number>`sum(case when status = 'occupied' then 1 else 0 end)::int` }).from(restaurantTables).where(eq(restaurantTables.tenantId, tenantId));
  return { openTickets: open?.count ?? 0, tables: tableRows[0]?.count ?? 0, occupied: tableRows[0]?.occupied ?? 0 };
}

export { desc };
