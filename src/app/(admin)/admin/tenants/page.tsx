import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { businesses, plans, subscriptions, tenants } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, SectionTitle } from "@/components/ui/page";
import { ActionButton } from "@/components/ui/action-form";
import { setTenantStatusAction } from "@/server/actions/platform";
import { formatCurrency, shortDate, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Workspaces" };
export const dynamic = "force-dynamic";

export default async function AdminTenantsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const params = await searchParams;
  const db = await getDb();
  const conditions = [];
  if (params.q) conditions.push(sql`(${tenants.name} ilike ${`%${params.q}%`} or ${tenants.slug} ilike ${`%${params.q}%`})`);
  if (params.status && params.status !== "all") conditions.push(sql`${tenants.status} = ${params.status}`);

  const rows = await db
    .select({
      tenant: tenants,
      business: businesses,
      planName: plans.name,
      planCode: plans.code,
      planPrice: plans.priceMonthly,
      planCurrency: plans.currency,
      subscription: subscriptions,
      users: sql<number>`(select count(*)::int from memberships m where m.tenant_id = ${tenants.id})`,
      sales: sql<string>`coalesce((select sum(s.total) from sales s where s.tenant_id = ${tenants.id}), 0)::text`,
    })
    .from(tenants)
    .leftJoin(businesses, eq(businesses.tenantId, tenants.id))
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(conditions.length ? sql.join(conditions, sql` and `) : undefined)
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <PageHeader title="Workspaces" description="Every tenant on the platform, with plan, usage and suspension controls." />

      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="mb-1 block text-[11px] font-medium muted">Search</span>
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Business name or slug" />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium muted">Status</span>
            <Select name="status" defaultValue={params.status ?? "all"}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="trialing">Trialing</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </label>
          <Button type="submit">Filter</Button>
        </form>
      </Card>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint={`${rows.length} workspaces`}>Tenants</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Workspace</Th><Th>Contact</Th><Th>Plan</Th><Th className="text-right">Users</Th><Th className="text-right">Gross sales</Th><Th>Status</Th><Th className="text-right">Controls</Th></tr></thead>
            <tbody>
              {rows.map(({ tenant, business, planName, planPrice, planCurrency, subscription, users, sales }) => (
                <Tr key={tenant.id}>
                  <Td>
                    <span className="text-[12.5px] font-medium">{tenant.name}</span>
                    <p className="font-mono text-[10.5px] muted">{tenant.slug} · created {shortDate(tenant.createdAt)}</p>
                  </Td>
                  <Td className="text-[11px] muted">{business?.email ?? "—"}<p>{business?.phone ?? ""}</p></Td>
                  <Td>
                    <span className="text-[11.5px]">{planName ?? "No plan"}</span>
                    {subscription ? <p className="text-[10px] muted">{subscription.status} · {subscription.interval} · {formatCurrency(planPrice ?? "0", planCurrency ?? tenant.currency)}</p> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{users}</Td>
                  <Td className="text-right tabular-nums">{formatCurrency(sales, tenant.currency)}</Td>
                  <Td><Badge tone={tenant.status === "active" ? "success" : tenant.status === "suspended" ? "danger" : "warning"}>{titleCase(tenant.status)}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {tenant.status === "suspended" ? (
                        <ActionButton action={setTenantStatusAction} payload={{ tenantId: tenant.id, status: "active" }} variant="secondary">Reactivate</ActionButton>
                      ) : (
                        <ActionButton
                          action={setTenantStatusAction}
                          payload={{ tenantId: tenant.id, status: "suspended", reason: "Suspended from the super-admin console" }}
                          variant="danger"
                          confirm={`Suspend ${tenant.name}? They will lose access immediately.`}
                        >
                          Suspend
                        </ActionButton>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 ? <Tr><Td colSpan={7} className="text-[12px] muted">No workspaces match this filter.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
      <p className="text-[11px] muted">Suspension is reversible and never deletes data. Deleting a workspace is intentionally not available from the UI.</p>
    </div>
  );
}
