import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { Truck, Wallet } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, businesses, products, purchaseOrders, suppliers } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, SectionTitle } from "@/components/ui/page";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { createPurchaseOrderAction, createSupplierAction, receivePurchaseOrderAction } from "@/server/actions/catalog";
import { formatCurrency, formatNumber, shortDate, titleCase } from "@/lib/utils";
import { payables } from "@/server/services/finance";

export const metadata: Metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const rows = await db
    .select({
      supplier: suppliers,
      orders: sql<number>`(select count(*)::int from purchase_orders po where po.supplier_id = ${suppliers.id})`,
    })
    .from(suppliers)
    .where(eq(suppliers.tenantId, auth.tenantId))
    .orderBy(asc(suppliers.name));

  const orders = await db
    .select({
      po: purchaseOrders,
      supplierName: suppliers.name,
      branchName: branches.name,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(branches, eq(branches.id, purchaseOrders.branchId))
    .where(eq(purchaseOrders.tenantId, auth.tenantId))
    .orderBy(asc(purchaseOrders.createdAt))
    .limit(30);

  const [branchRows, productRows, owed] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId)),
    db.select({ id: products.id, name: products.name, costPrice: products.costPrice }).from(products).where(and(eq(products.tenantId, auth.tenantId), eq(products.isActive, true))).orderBy(asc(products.name)),
    payables(db, auth.tenantId),
  ]);

  const openOrders = orders.filter((o) => o.po.status !== "received" && o.po.status !== "cancelled");

  return (
    <>
      <Topbar title="Suppliers" subtitle="Purchase orders, receiving and supplier balances" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Suppliers" value={formatNumber(rows.length)} icon={<Truck className="size-4" />} />
          <StatCard label="Open purchase orders" value={formatNumber(openOrders.length)} hint={`${orders.length} recorded`} tone={openOrders.length ? "warning" : "default"} />
          <StatCard label="Accounts payable" value={formatCurrency(owed.total, currency)} hint="Owed to suppliers" icon={<Wallet className="size-4" />} />
          <StatCard label="Purchases this period" value={formatCurrency(orders.reduce((s, o) => s + Number(o.po.total), 0).toFixed(2), currency)} hint="All purchase orders" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Disclosure title="Add a supplier" description="Vendor record used for purchasing and payables." cta="New supplier" defaultOpen={rows.length === 0}>
            <ActionForm action={createSupplierAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier name *" className="sm:col-span-2"><Input name="name" required placeholder="Lagos Beverages Ltd" /></Field>
              <Field label="Contact person"><Input name="contactName" /></Field>
              <Field label="Phone"><Input name="phone" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Address"><Input name="address" /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} /></Field>
              <div className="sm:col-span-2"><SubmitButton>Add supplier</SubmitButton></div>
            </ActionForm>
          </Disclosure>

          <Disclosure title="Raise a purchase order" description="Receiving a PO increases stock and posts to the ledger." cta="New PO">
            <ActionForm action={createPurchaseOrderAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier *">
                <Select name="supplierId" required>
                  {rows.map((r) => <option key={r.supplier.id} value={r.supplier.id}>{r.supplier.name}</option>)}
                </Select>
              </Field>
              <Field label="Deliver to">
                <Select name="branchId" defaultValue={branchRows[0]?.id ?? ""}>
                  {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Product *">
                <Select name="productId" required>
                  {productRows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Quantity *"><Input name="quantity" type="number" step="0.001" min="0.001" required /></Field>
                <Field label="Unit cost *"><Input name="unitCost" type="number" step="0.01" min="0" required /></Field>
              </div>
              <div className="sm:col-span-2"><SubmitButton variant="secondary">Create purchase order</SubmitButton></div>
            </ActionForm>
          </Disclosure>
        </div>

        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Receive to add stock">Purchase orders</SectionTitle></div>
          {orders.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] muted">No purchase orders yet.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead><tr><Th>Reference</Th><Th>Supplier</Th><Th>Branch</Th><Th>Created</Th><Th className="text-right">Total</Th><Th>Status</Th><Th className="text-right">Action</Th></tr></thead>
                <tbody>
                  {orders.map(({ po, supplierName, branchName }) => (
                    <Tr key={po.id}>
                      <Td className="font-mono text-[11.5px]">{po.reference}</Td>
                      <Td className="text-[12px]">{supplierName ?? "—"}</Td>
                      <Td className="text-[11.5px] muted">{branchName}</Td>
                      <Td className="text-[11px] muted">{shortDate(po.createdAt)}</Td>
                      <Td className="text-right tabular-nums">{formatCurrency(po.total, currency)}</Td>
                      <Td><Badge tone={po.status === "received" ? "success" : po.status === "cancelled" ? "danger" : "warning"}>{titleCase(po.status)}</Badge></Td>
                      <Td className="text-right">
                        {po.status !== "received" && po.status !== "cancelled" ? (
                          <ActionButton action={receivePurchaseOrderAction} payload={{ poId: po.id }} confirm={`Receive ${po.reference}? This adds stock and posts payables.`}>
                            Receive
                          </ActionButton>
                        ) : (
                          <span className="text-[11px] muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <TableWrap>
          <Table>
            <thead><tr><Th>Supplier</Th><Th>Contact</Th><Th>Phone</Th><Th className="text-right">Orders</Th><Th className="text-right">Balance owed</Th></tr></thead>
            <tbody>
              {rows.map(({ supplier, orders: count }) => (
                <Tr key={supplier.id}>
                  <Td className="text-[12.5px] font-medium">{supplier.name}</Td>
                  <Td className="text-[11.5px] muted">{supplier.contactName ?? "—"}</Td>
                  <Td className="text-[11.5px] muted">{supplier.phone ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{count}</Td>
                  <Td className="text-right tabular-nums">{formatCurrency(supplier.balanceOwed, currency)}</Td>
                </Tr>
              ))}
              {rows.length === 0 ? <Tr><Td colSpan={5} className="text-[12px] muted">Add a supplier to start raising purchase orders.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
      </PageBody>
    </>
  );
}
