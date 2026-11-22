import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeftRight, ClipboardList, PackageSearch, Warehouse } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, businesses, products, stockTransfers } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, PageHeader, SectionTitle } from "@/components/ui/page";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { adjustStockAction, receiveTransferAction, transferStockAction } from "@/server/actions/catalog";
import { inventoryValuation, lowStockItems, movementLedger, recommendRestock, slowMovingProducts } from "@/server/services/inventory";
import { formatCurrency, formatNumber, relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const branchRows = await db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId));
  const branchId = params.branch && branchRows.some((b) => b.id === params.branch) ? params.branch : branchRows[0]?.id ?? "";

  const [low, valuation, movements, restock, slow, transfers, productRows] = await Promise.all([
    branchId ? lowStockItems(db, auth.tenantId, branchId) : Promise.resolve([]),
    inventoryValuation(db, auth.tenantId),
    movementLedger(db, auth.tenantId, 25),
    recommendRestock(db, auth.tenantId, branchId, { leadTimeDays: 7, coverDays: 14 }).catch(() => [] as Awaited<ReturnType<typeof recommendRestock>>),
    slowMovingProducts(db, auth.tenantId, 60).catch(() => ({ totalValue: "0", products: [] as { id: string; name: string; sku: string; cost: string; price: string }[] })),
    db
      .select({ id: stockTransfers.id, reference: stockTransfers.reference, status: stockTransfers.status, createdAt: stockTransfers.createdAt })
      .from(stockTransfers)
      .where(eq(stockTransfers.tenantId, auth.tenantId))
      .orderBy(asc(stockTransfers.createdAt))
      .limit(10),
    db
      .select({ id: products.id, name: products.name, sku: products.sku, costPrice: products.costPrice, trackStock: products.trackStock })
      .from(products)
      .where(and(eq(products.tenantId, auth.tenantId), eq(products.isActive, true)))
      .orderBy(asc(products.name))
      .limit(500),
  ]);

  const totalUnits = valuation.reduce((s, v) => s + Number(v.quantity), 0);
  const totalValue = valuation.reduce((s, v) => s + Number(v.value), 0);
  const inTransit = transfers.filter((t) => t.status === "in_transit").length;

  return (
    <>
      <Topbar title="Inventory" subtitle="Stock accuracy across every branch, with AI restock guidance" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Units on hand" value={formatNumber(totalUnits)} hint={`${productRows.length} active products`} icon={<Warehouse className="size-4" />} />
          <StatCard label="Stock value" value={formatCurrency(totalValue.toFixed(2), currency)} hint="Weighted average cost" tone="positive" />
          <StatCard label="Low stock" value={formatNumber(low.length)} hint="At or below reorder point" tone={low.length ? "warning" : "default"} icon={<PackageSearch className="size-4" />} />
          <StatCard label="Transfers in transit" value={formatNumber(inTransit)} hint={`${transfers.length} transfers recorded`} icon={<ArrowLeftRight className="size-4" />} />
        </div>

        <Card className="flex flex-wrap items-end gap-2 p-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Field label="Branch">
              <Select name="branch" defaultValue={branchId}>
                {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <SubmitButton variant="outline">View branch</SubmitButton>
          </form>
          <p className="ml-auto text-[11.5px] muted">Adjustments are append-only stock movements and cannot be edited after posting.</p>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Disclosure title="Adjust stock" description="Post a physical count, damage write-off or receipt correction." cta="Adjust" defaultOpen={low.length > 0}>
            <ActionForm action={adjustStockAction} className="grid gap-3">
              <input type="hidden" name="branchId" value={branchId} />
              <Field label="Product *">
                <Select name="productId" required>
                  {productRows.filter((p) => p.trackStock).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Counted quantity *"><Input name="quantity" type="number" step="0.001" min="0" required /></Field>
                <Field label="Reason"><Input name="reason" placeholder="Stock count / damage" defaultValue="Stock count" /></Field>
              </div>
              <SubmitButton variant="secondary">Post adjustment</SubmitButton>
            </ActionForm>
          </Disclosure>

          <Disclosure title="Transfer between branches" description="Move stock with a full in-transit trail." cta="Transfer">
            <ActionForm action={transferStockAction} className="grid gap-3">
              <Field label="Product *">
                <Select name="productId" required>
                  {productRows.filter((p) => p.trackStock).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="From">
                  <Select name="fromBranchId" defaultValue={branchId}>
                    {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="To">
                  <Select name="toBranchId" defaultValue={branchRows[1]?.id ?? branchId}>
                    {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="Quantity"><Input name="quantity" type="number" step="0.001" min="0.001" required /></Field>
              </div>
              <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Van 2 · driver Kunle" /></Field>
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" name="receiveNow" className="size-4 rounded border-[var(--border)]" /> Receive immediately at destination
              </label>
              <SubmitButton variant="outline">Create transfer</SubmitButton>
            </ActionForm>
          </Disclosure>
        </div>

        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Sorted by shortfall">Low stock alerts</SectionTitle></div>
          {low.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] muted">Every tracked product is above its reorder point at this branch.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead><tr><Th>Product</Th><Th className="text-right">On hand</Th><Th className="text-right">Reorder at</Th><Th className="text-right">Suggested</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {low.slice(0, 20).map((item) => (
                    <Tr key={item.productId}>
                      <Td><span className="text-[12.5px] font-medium">{item.name}</span><p className="font-mono text-[10.5px] muted">{item.sku}</p></Td>
                      <Td className="text-right tabular-nums">{formatNumber(Number(item.quantity))}</Td>
                      <Td className="text-right tabular-nums muted">{formatNumber(Number(item.reorderPoint))}</Td>
                      <Td className="text-right tabular-nums font-medium">{formatNumber(Number(item.reorderQty))}</Td>
                      <Td><Badge tone={Number(item.quantity) <= 0 ? "danger" : "warning"}>{Number(item.quantity) <= 0 ? "Out of stock" : "Low"}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Demand forecast · 14-day cover">AI restock suggestions</SectionTitle></div>
          {restock.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] muted">No restock suggestions — demand is covered by current stock.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead><tr><Th>Product</Th><Th className="text-right">Daily velocity</Th><Th className="text-right">Days cover</Th><Th className="text-right">Suggested order</Th><Th className="text-right">Est. cost</Th></tr></thead>
                <tbody>
                  {restock.slice(0, 10).map((r) => (
                    <Tr key={r.productId}>
                      <Td><span className="text-[12.5px] font-medium">{r.name}</span><p className="text-[10.5px] muted">{r.reasoning}</p></Td>
                      <Td className="text-right tabular-nums">{Number(r.dailyVelocity).toFixed(2)}</Td>
                      <Td className="text-right tabular-nums">{r.daysOfCover.toFixed(1)}</Td>
                      <Td className="text-right tabular-nums font-medium">{formatNumber(Number(r.suggestedQty))}</Td>
                      <Td className="text-right tabular-nums">{formatCurrency(r.estimatedCost, currency)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-0">
            <div className="p-4"><SectionTitle hint="Immutable audit trail">Stock movements</SectionTitle></div>
            <TableWrap>
              <Table>
                <thead><tr><Th>When</Th><Th>Product</Th><Th>Type</Th><Th className="text-right">Change</Th><Th className="text-right">Balance</Th></tr></thead>
                <tbody>
                  {movements.map((m) => (
                    <Tr key={m.id}>
                      <Td className="whitespace-nowrap text-[11px] muted">{relativeTime(m.createdAt)}</Td>
                      <Td className="text-[12px]">{m.productName}<p className="text-[10.5px] muted">{m.branchName}</p></Td>
                      <Td><Badge tone={Number(m.quantityDelta) >= 0 ? "success" : "warning"}>{titleCase(m.type)}</Badge></Td>
                      <Td className={`text-right tabular-nums ${Number(m.quantityDelta) >= 0 ? "text-brand" : "text-red-600"}`}>{Number(m.quantityDelta) > 0 ? "+" : ""}{formatNumber(Number(m.quantityDelta))}</Td>
                      <Td className="text-right tabular-nums muted">{formatNumber(Number(m.balanceAfter))}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <SectionTitle hint="No sales in 60 days">Slow movers</SectionTitle>
              <ul className="mt-3 space-y-2">
                {slow.products.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 tabular-nums muted">{formatCurrency(s.price, currency)}</span>
                  </li>
                ))}
                {slow.products.length === 0 ? <li className="text-[11.5px] muted">Nothing is sitting idle right now.</li> : null}
              </ul>
            </Card>

            <Card className="p-4">
              <SectionTitle hint={`${transfers.length} total`}>Recent transfers</SectionTitle>
              <ul className="mt-3 space-y-2">
                {transfers.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="font-mono text-[11px]">{t.reference}</span>
                    {t.status === "in_transit" ? (
                      <ActionButton action={receiveTransferAction} payload={{ transferId: t.id }} variant="outline">Receive</ActionButton>
                    ) : (
                      <Badge tone={t.status === "received" ? "success" : "neutral"}>{titleCase(t.status)}</Badge>
                    )}
                  </li>
                ))}
                {transfers.length === 0 ? <li className="text-[11.5px] muted">No transfers yet.</li> : null}
              </ul>
            </Card>
          </div>
        </div>

        <Card className="flex items-start gap-2 p-4 text-[11.5px] muted">
          <ClipboardList className="mt-0.5 size-4 shrink-0" />
          <p>
            Stock movements, journals and audit events are protected by database triggers that reject updates and deletes. Corrections are posted as
            compensating entries, which keeps every report reproducible and audit-ready.
          </p>
        </Card>
        <PageHeader title="" description="" className="hidden" />
      </PageBody>
    </>
  );
}
