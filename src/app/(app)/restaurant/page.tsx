import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ChefHat, Coffee, ConciergeBell, UtensilsCrossed } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, businesses, products, restaurantTables } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, SectionTitle } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/link-button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { addMenuItemAction, advanceKitchenAction, createReservationAction, setTableStatusAction } from "@/server/actions/ops";
import { kitchenQueue, menu, reservationsFor, restaurantStats } from "@/server/services/restaurant";
import { formatCurrency, dateTime, titleCase, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Restaurant" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { free: "success", occupied: "warning", reserved: "info", cleaning: "neutral" } as const;

export default async function RestaurantPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const branchRows = await db.select({ id: branches.id, name: branches.name, type: branches.type }).from(branches).where(eq(branches.tenantId, auth.tenantId));
  const branchId = auth.branchId ?? branchRows.find((b) => b.type === "restaurant")?.id ?? branchRows[0]?.id ?? "";

  const [tableRows, stats, tickets, upcoming, menuData, productRows] = await Promise.all([
    db.select().from(restaurantTables).where(and(eq(restaurantTables.tenantId, auth.tenantId), eq(restaurantTables.branchId, branchId))).orderBy(asc(restaurantTables.label)),
    restaurantStats(db, auth.tenantId),
    kitchenQueue(db, auth.tenantId),
    reservationsFor(db, auth.tenantId, 3),
    menu(db, auth.tenantId, branchId),
    db.select({ id: products.id, name: products.name, price: products.price }).from(products).where(and(eq(products.tenantId, auth.tenantId), eq(products.isMenuItem, true))).orderBy(asc(products.name)),
  ]);

  const menuRows = menuData.items;
  const activeMenu = menuData.menus.slice(0, 1);

  return (
    <>
      <Topbar
        title="Restaurant"
        subtitle="Tables, kitchen display, menu and reservations"
        actions={<LinkButton href="/pos" size="sm" variant="secondary"><UtensilsCrossed className="size-3.5" /> Open order screen</LinkButton>}
      />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Tables" value={`${stats.occupied}/${stats.tables}`} hint="Occupied / total" icon={<ConciergeBell className="size-4" />} />
          <StatCard label="Open tickets" value={String(stats.openTickets)} hint="Queued or preparing" tone={stats.openTickets > 4 ? "warning" : "default"} icon={<ChefHat className="size-4" />} />
          <StatCard label="Reservations" value={String(upcoming.length)} hint="Next 3 days" icon={<Coffee className="size-4" />} />
          <StatCard label="Menu items" value={String(menuRows.length)} hint={activeMenu[0] ? titleCase(activeMenu[0].name) : "No menu published"} icon={<UtensilsCrossed className="size-4" />} />
        </div>

        <Card className="p-4">
          <SectionTitle hint="Tap a table to change its status">Floor plan</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {tableRows.map((table) => (
              <div key={table.id} className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold">{table.label}</span>
                  <Badge tone={STATUS_TONE[table.status]}>{titleCase(table.status)}</Badge>
                </div>
                <p className="mt-1 text-[10.5px] muted">{table.seats} seats · {table.area ?? "Main"}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(["free", "occupied", "reserved", "cleaning"] as const)
                    .filter((status) => status !== table.status)
                    .slice(0, 2)
                    .map((status) => (
                      <ActionButton key={status} action={setTableStatusAction} payload={{ tableId: table.id, status }} variant="ghost">{titleCase(status)}</ActionButton>
                    ))}
                </div>
              </div>
            ))}
            {tableRows.length === 0 ? <p className="text-[12px] muted">No tables configured for this branch yet.</p> : null}
          </div>
        </Card>

        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Oldest first">Kitchen display</SectionTitle></div>
          {tickets.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] muted">No open tickets. Orders from the POS appear here instantly.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead><tr><Th>Ticket</Th><Th>Station</Th><Th>Table</Th><Th>Items</Th><Th>Status</Th><Th className="text-right">Advance</Th></tr></thead>
                <tbody>
                  {tickets.map(({ order, tableLabel }) => (
                    <Tr key={order.id}>
                      <Td className="font-mono text-[11px]">{order.id.slice(0, 8)}<p className="text-[10px] muted">{relativeTime(order.createdAt)}</p></Td>
                      <Td><Badge tone="neon">{titleCase(order.station)}</Badge></Td>
                      <Td className="text-[11.5px] muted">{tableLabel ?? "—"}</Td>
                      <Td className="max-w-[260px] text-[11.5px]">{order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}{order.notes ? <p className="text-[10.5px] muted">{order.notes}</p> : null}</Td>
                      <Td><Badge tone={order.status === "ready" ? "success" : order.status === "preparing" ? "warning" : "neutral"}>{titleCase(order.status)}</Badge></Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          {order.status === "queued" ? <ActionButton action={advanceKitchenAction} payload={{ orderId: order.id, status: "preparing" }}>Start</ActionButton> : null}
                          {order.status === "preparing" ? <ActionButton action={advanceKitchenAction} payload={{ orderId: order.id, status: "ready" }}>Ready</ActionButton> : null}
                          {order.status === "ready" ? <ActionButton action={advanceKitchenAction} payload={{ orderId: order.id, status: "served" }}>Served</ActionButton> : null}
                          <ActionButton action={advanceKitchenAction} payload={{ orderId: order.id, status: "cancelled" }} variant="ghost" confirm="Cancel this ticket?">Cancel</ActionButton>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <SectionTitle hint={`${upcoming.length} upcoming`}>Reservations</SectionTitle>
            <ul className="mt-3 space-y-2 text-[12px]">
              {upcoming.map(({ reservation, tableLabel }) => (
                <li key={reservation.id} className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{reservation.customerName} · {reservation.partySize} guests</p>
                    <p className="text-[10.5px] muted">{dateTime(reservation.reservedAt)} · {tableLabel ?? "Unassigned"}</p>
                  </div>
                  <Badge tone={reservation.status === "seated" ? "success" : reservation.status === "cancelled" ? "danger" : reservation.status === "no_show" ? "danger" : "warning"}>{titleCase(reservation.status)}</Badge>
                </li>
              ))}
              {upcoming.length === 0 ? <li className="muted">No reservations in the next three days.</li> : null}
            </ul>
            <Disclosure title="New reservation" cta="Book" defaultOpen={false}>
              <ActionForm action={createReservationAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="branchId" value={branchId} />
                <Field label="Guest name *"><Input name="customerName" required /></Field>
                <Field label="Phone"><Input name="phone" /></Field>
                <Field label="Party size"><Input name="partySize" type="number" min="1" max="30" defaultValue="2" /></Field>
                <Field label="Table">
                  <Select name="tableId" defaultValue="">
                    <option value="">Unassigned</option>
                    {tableRows.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </Select>
                </Field>
                <Field label="When"><Input name="reservedAt" type="datetime-local" required /></Field>
                <Field label="Notes"><Textarea name="notes" rows={1} /></Field>
                <div className="sm:col-span-2"><SubmitButton>Save reservation</SubmitButton></div>
              </ActionForm>
            </Disclosure>
          </Card>

          <Card className="p-4">
            <SectionTitle hint={activeMenu[0] ? "Live menu" : "No menu yet"}>Menu</SectionTitle>
            <ul className="mt-3 space-y-1.5 text-[12px]">
              {menuRows.slice(0, 10).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{item.name ?? item.productId}</span>
                  <span className="tabular-nums muted">{formatCurrency(item.price, currency)} · {titleCase(item.station)}</span>
                </li>
              ))}
              {menuRows.length === 0 ? <li className="muted">Publish a menu to sell restaurant items.</li> : null}
            </ul>
            {activeMenu[0] ? (
              <Disclosure title="Add a menu item" description="Pick a product that is flagged as a menu item." cta="Add item">
                <ActionForm action={addMenuItemAction} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="menuId" value={activeMenu[0].id} />
                  <Field label="Product">
                    <Select name="productId" required>{productRows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                  </Field>
                  <Field label="Price"><Input name="price" type="number" step="0.01" min="0.01" required /></Field>
                  <Field label="Station">
                    <Select name="station" defaultValue="kitchen">
                      <option value="kitchen">Kitchen</option>
                      <option value="bar">Bar</option>
                      <option value="grill">Grill</option>
                    </Select>
                  </Field>
                  <div className="flex items-end"><SubmitButton variant="outline">Add to menu</SubmitButton></div>
                </ActionForm>
              </Disclosure>
            ) : (
              <p className="mt-3 text-[11.5px] muted">
                A super admin or owner can create the restaurant menu record for this branch. POS orders still flow to the kitchen display.
              </p>
            )}
          </Card>
        </div>

        <Card className="p-4 text-[11.5px] muted">
          <p>
            Walk-in orders taken on the <Link href="/pos" className="font-medium text-brand">POS</Link> with menu items automatically create kitchen tickets,
            tag the station and free the table once served. Service charge and tips follow the branch settings.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
