import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { Crown, HandCoins, Search, Users } from "lucide-react";
import { getDb } from "@/server/db";
import { businesses, customers, sales as salesTable } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, SectionTitle } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/empty";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { createCustomerAction, recordCustomerPaymentAction } from "@/server/actions/crm";
import { customerInsights } from "@/server/services/reports";
import { formatCurrency, formatNumber, relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; segment?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const conditions = [eq(customers.tenantId, auth.tenantId)];
  if (params.q) conditions.push(sql`(lower(${customers.name}) like ${`%${params.q.toLowerCase()}%`} or ${customers.phone} like ${`%${params.q}%`})`);
  if (params.segment && params.segment !== "all") conditions.push(eq(customers.segment, params.segment as "active" | "new" | "loyal" | "at_risk" | "inactive"));

  const rows = await db
    .select({
      customer: customers,
      spend: sql<string>`coalesce((select sum(s.total) from sales s where s.customer_id = ${customers.id} and s.status in ('completed','partially_refunded')), 0)::text`,
      visits: sql<number>`(select count(*)::int from sales s where s.customer_id = ${customers.id})`,
      lastVisit: sql<Date | null>`(select max(s.created_at) from sales s where s.customer_id = ${customers.id})`,
    })
    .from(customers)
    .where(and(...conditions))
    .orderBy(desc(customers.totalSpent))
    .limit(200);

  const insights = await customerInsights(db, auth.tenantId);
  const owing = rows.filter((r) => Number(r.customer.balanceOwed) > 0);
  const recent = await db
    .select({ id: salesTable.id, number: salesTable.number, total: salesTable.total, createdAt: salesTable.createdAt, customerName: customers.name })
    .from(salesTable)
    .innerJoin(customers, eq(customers.id, salesTable.customerId))
    .where(eq(salesTable.tenantId, auth.tenantId))
    .orderBy(desc(salesTable.createdAt))
    .limit(6);

  return (
    <>
      <Topbar title="Customers" subtitle="CRM, loyalty segments and credit balances" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Customers" value={formatNumber(insights.totalCustomers)} hint={`${insights.active} active · ${insights.loyal} loyal`} icon={<Users className="size-4" />} />
          <StatCard label="At risk" value={formatNumber(insights.atRisk)} hint={`${insights.inactive} inactive (90+ days)`} tone={insights.atRisk ? "warning" : "default"} />
          <StatCard label="Average lifetime value" value={formatCurrency(insights.averageLifetimeValue, currency)} hint={`Total spend ${formatCurrency(insights.totalSpent, currency)}`} tone="positive" />
          <StatCard label="Outstanding credit" value={formatCurrency(insights.creditOutstanding, currency)} hint={`${owing.length} accounts owing`} tone={owing.length ? "warning" : "default"} icon={<HandCoins className="size-4" />} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Disclosure title="Add a customer" description="Capture contact details, credit limit and consent." cta="New customer" defaultOpen={rows.length === 0}>
            <ActionForm action={createCustomerAction} className="grid gap-3">
              <Field label="Full name *"><Input name="name" required placeholder="Amaka Obi" /></Field>
              <Field label="Phone"><Input name="phone" placeholder="0803 000 0000" /></Field>
              <Field label="Email"><Input name="email" type="email" placeholder="amaka@example.com" /></Field>
              <Field label="Address"><Textarea name="address" rows={2} /></Field>
              <Field label="Credit limit"><Input name="creditLimit" type="number" step="0.01" min="0" defaultValue="0" /></Field>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="marketingConsent" className="size-4 rounded border-[var(--border)]" /> Consent to marketing</label>
                <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="whatsappConsent" className="size-4 rounded border-[var(--border)]" /> Consent to WhatsApp messages</label>
              </div>
              <SubmitButton>Add customer</SubmitButton>
            </ActionForm>
          </Disclosure>

          <Card className="p-4 lg:col-span-2">
            <SectionTitle hint="Top segments by spend">Loyalty segments</SectionTitle>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                { key: "loyal", count: insights.loyal, hint: "5+ purchases" },
                { key: "active", count: insights.active, hint: "Bought in the last 30 days" },
                { key: "at_risk", count: insights.atRisk, hint: "30–90 days quiet" },
                { key: "inactive", count: insights.inactive, hint: "90+ days or never" },
              ].map((segment) => (
                <Link key={segment.key} href={`/customers?segment=${segment.key}`} className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2 hover:border-brand/60">
                  <span className="inline-flex items-center gap-2 text-[12px]">
                    {segment.key === "loyal" ? <Crown className="size-3.5 text-brand" /> : null}
                    {titleCase(segment.key)}
                  </span>
                  <span className="text-[11.5px] tabular-nums muted">{segment.count} · {segment.hint}</span>
                </Link>
              ))}
            </div>
            <SectionTitle hint="Latest"><span>Recent customer activity</span></SectionTitle>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {recent.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <span className="truncate">{sale.customerName}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatCurrency(sale.total, currency)}</span>
                    <Link href={`/receipt/${sale.id}`} className="text-[11px] font-medium text-brand">{sale.number}</Link>
                    <span className="hidden text-[10.5px] muted sm:inline">{relativeTime(sale.createdAt)}</span>
                  </span>
                </li>
              ))}
              {recent.length === 0 ? <li className="py-1.5 text-[11.5px] muted">No customer sales yet.</li> : null}
            </ul>
          </Card>
        </div>

        <Card className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Field label="Search" className="min-w-[200px] flex-1"><Input name="q" defaultValue={params.q ?? ""} placeholder="Name or phone" /></Field>
            <Button type="submit"><Search className="size-3.5" /> Search</Button>
          </form>
        </Card>

        {rows.length === 0 ? (
          <EmptyState title="No customers yet" description="Add your first customer to start tracking loyalty, credit and purchase history." />
        ) : (
          <TableWrap>
            <Table>
              <thead><tr><Th>Customer</Th><Th>Segment</Th><Th className="text-right">Visits</Th><Th className="text-right">Spend</Th><Th className="text-right">Owing</Th><Th>Last visit</Th><Th className="text-right">Credit payment</Th></tr></thead>
              <tbody>
                {rows.map(({ customer, spend, visits, lastVisit }) => (
                  <Tr key={customer.id}>
                    <Td>
                      <span className="text-[12.5px] font-medium">{customer.name}</span>
                      <p className="text-[10.5px] muted">{customer.phone ?? customer.email ?? "No contact"}</p>
                    </Td>
                    <Td><Badge tone={customer.segment === "loyal" ? "neon" : customer.segment === "active" ? "success" : customer.segment === "at_risk" ? "warning" : "neutral"}>{titleCase(customer.segment)}</Badge></Td>
                    <Td className="text-right tabular-nums">{visits}</Td>
                    <Td className="text-right tabular-nums">{formatCurrency(spend, currency)}</Td>
                    <Td className="text-right tabular-nums">{Number(customer.balanceOwed) > 0 ? <span className="font-medium text-amber-600">{formatCurrency(customer.balanceOwed, currency)}</span> : "—"}</Td>
                    <Td className="text-[11px] muted">{lastVisit ? relativeTime(lastVisit) : "Never"}</Td>
                    <Td className="text-right">
                      {Number(customer.balanceOwed) > 0 ? (
                        <ActionButton action={recordCustomerPaymentAction} payload={{ customerId: customer.id, amount: customer.balanceOwed }} confirm={`Record a full payment of ${formatCurrency(customer.balanceOwed, currency)} from ${customer.name}?`}>
                          Settle
                        </ActionButton>
                      ) : (
                        <span className="text-[11px] muted">Settled</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </PageBody>
    </>
  );
}
