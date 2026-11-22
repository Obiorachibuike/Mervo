import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Receipt, RotateCcw, Search, Wallet } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, customers, sales as salesTable, users } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { PageBody } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/link-button";
import { ActionButton } from "@/components/ui/action-form";
import { refundSaleAction } from "@/server/actions/sales";
import { formatCurrency, dateTime, titleCase } from "@/lib/utils";
import { salesSummary, rangeFromDays } from "@/server/services/reports";

export const metadata: Metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; branch?: string; days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const days = Number(params.days ?? 30);
  const currency = auth.tenant?.currency ?? "NGN";
  const fromDate = params.from ? new Date(params.from) : rangeFromDays(Number.isFinite(days) ? days : 30).from;
  const toDate = params.to ? new Date(`${params.to}T23:59:59`) : new Date();

  const filters = [eq(salesTable.tenantId, auth.tenantId), gte(salesTable.createdAt, fromDate), lte(salesTable.createdAt, toDate)];
  if (params.status && params.status !== "all") filters.push(sql`${salesTable.status} = ${params.status}`);
  if (params.branch && params.branch !== "all") filters.push(eq(salesTable.branchId, params.branch));
  if (params.q) filters.push(sql`(${salesTable.number} ilike ${`%${params.q}%`} or ${customers.name} ilike ${`%${params.q}%`})`);

  const rows = await db
    .select({
      id: salesTable.id,
      number: salesTable.number,
      total: salesTable.total,
      subtotal: salesTable.subtotal,
      taxTotal: salesTable.taxTotal,
      discountTotal: salesTable.discountTotal,
      status: salesTable.status,
      paymentStatus: salesTable.paymentStatus,
      source: salesTable.source,
      currency: salesTable.currency,
      createdAt: salesTable.createdAt,
      balanceDue: salesTable.balanceDue,
      branchName: branches.name,
      customerName: customers.name,
      cashierName: users.name,
    })
    .from(salesTable)
    .leftJoin(branches, eq(branches.id, salesTable.branchId))
    .leftJoin(customers, eq(customers.id, salesTable.customerId))
    .leftJoin(users, eq(users.id, salesTable.createdBy))
    .where(and(...filters))
    .orderBy(desc(salesTable.createdAt))
    .limit(200);

  const summary = await salesSummary(db, auth.tenantId, { from: fromDate, to: toDate });
  const branchRows = await db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId));
  const outstanding = rows.reduce((sum, row) => sum + Number(row.balanceDue), 0);

  return (
    <>
      <Topbar title="Sales" subtitle="Every transaction, receipt and refund in one ledger" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Gross sales" value={formatCurrency(summary.gross, currency)} hint={`${summary.count} transactions`} />
          <StatCard label="Net revenue" value={formatCurrency(summary.netRevenue, currency)} hint={`Gross profit ${formatCurrency(summary.grossProfit, currency)}`} tone="positive" />
          <StatCard label="Tax collected" value={formatCurrency(summary.tax, currency)} hint={`Discounts ${formatCurrency(summary.discount, currency)}`} />
          <StatCard label="Unpaid balance" value={formatCurrency(outstanding.toFixed(2), currency)} hint="Credit sales still open" tone={outstanding > 0 ? "warning" : "default"} />
        </div>

        <Card className="p-4">
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="min-w-[200px] flex-1">
              <span className="mb-1 block text-[11px] font-medium muted">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-charcoal/40" />
                <Input name="q" defaultValue={params.q ?? ""} placeholder="Receipt number or customer" className="pl-8" />
              </div>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium muted">Status</span>
              <Select name="status" defaultValue={params.status ?? "all"}>
                <option value="all">All</option>
                <option value="completed">Completed</option>
                <option value="refunded">Refunded</option>
                <option value="partially_refunded">Part refunded</option>
                <option value="voided">Voided</option>
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium muted">Branch</span>
              <Select name="branch" defaultValue={params.branch ?? "all"}>
                <option value="all">All branches</option>
                {branchRows.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium muted">Period</span>
              <Select name="days" defaultValue={String(days)}>
                <option value="1">Today</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">12 months</option>
              </Select>
            </label>
            <Button type="submit" size="md">Apply</Button>
          </form>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            title="No sales in this period"
            description="Open the terminal to record your first sale, or widen the date range above."
            action={<LinkButton href="/pos" size="sm">Open POS</LinkButton>}
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>When</Th>
                  <Th>Customer</Th>
                  <Th>Branch</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/receipt/${row.id}`} className="font-mono text-[12px] font-medium hover:text-brand">
                        {row.number}
                      </Link>
                      <p className="text-[10.5px] muted">{titleCase(row.source)}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-[11.5px] muted">{dateTime(row.createdAt)}</Td>
                    <Td>
                      <span className="text-[12px]">{row.customerName ?? "Walk-in"}</span>
                      <p className="text-[10.5px] muted">{row.cashierName ?? "—"}</p>
                    </Td>
                    <Td className="text-[12px] muted">{row.branchName}</Td>
                    <Td className="text-right tabular-nums">
                      <span className="font-medium">{formatCurrency(row.total, row.currency)}</span>
                      {Number(row.balanceDue) > 0 ? <p className="text-[10.5px] text-amber-600">Due {formatCurrency(row.balanceDue, row.currency)}</p> : null}
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={row.status === "completed" ? "success" : row.status === "voided" ? "danger" : "warning"}>{titleCase(row.status)}</Badge>
                        <Badge tone={row.paymentStatus === "paid" ? "success" : row.paymentStatus === "partial" ? "warning" : "neutral"}>{titleCase(row.paymentStatus)}</Badge>
                      </div>
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <LinkButton href={`/receipt/${row.id}`} variant="ghost" size="sm">
                          <Receipt className="size-3.5" /> Receipt
                        </LinkButton>
                        {row.status !== "voided" ? (
                          <ActionButton
                            action={refundSaleAction}
                            payload={{ saleId: row.id, reason: "Customer return", method: "cash", restock: "on" }}
                            variant="outline"
                            confirm={`Refund the first item on ${row.number}? This posts a reversal to the ledger.`}
                          >
                            <RotateCcw className="size-3.5" /> Refund
                          </ActionButton>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}

        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-[11.5px] muted">
          <span className="inline-flex items-center gap-1.5">
            <Wallet className="size-3.5" /> Refunds reverse inventory and post to account 5100. Voiding is audited as a critical event.
          </span>
          <span>Showing up to 200 most recent transactions.</span>
        </Card>
      </PageBody>
    </>
  );
}
