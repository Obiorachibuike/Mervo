import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { SectionTitle } from "@/components/ui/page";
import { PagePermission } from "@/components/shell/permission-gate";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { createBranchAction } from "@/server/actions/team";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Branches" };
export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const rows = await db
    .select({
      branch: branches,
      stock: sql<string>`coalesce((select sum(sl.quantity) from stock_levels sl where sl.branch_id = ${branches.id}), 0)::text`,
      salesCount: sql<number>`(select count(*)::int from sales s where s.branch_id = ${branches.id})`,
      revenue: sql<string>`coalesce((select sum(s.total) from sales s where s.branch_id = ${branches.id} and s.status = 'completed'), 0)::text`,
    })
    .from(branches)
    .where(eq(branches.tenantId, auth.tenantId))
    .orderBy(branches.name);

  return (
    <div className="space-y-4">
      <PagePermission permission="branches.manage">
        <Card className="p-4">
          <SectionTitle hint="Each branch keeps its own stock, sales and staff">Add a branch</SectionTitle>
          <ActionForm action={createBranchAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name *"><Input name="name" required placeholder="Ikeja City Mall" /></Field>
            <Field label="Code *"><Input name="code" required placeholder="IKJ" maxLength={20} /></Field>
            <Field label="Type">
              <Select name="type" defaultValue="store">
                <option value="store">Store</option>
                <option value="restaurant">Restaurant</option>
                <option value="warehouse">Warehouse</option>
                <option value="hotel">Hotel</option>
              </Select>
            </Field>
            <Field label="Phone"><Input name="phone" /></Field>
            <Field label="Address" className="sm:col-span-2 lg:col-span-3"><Input name="address" /></Field>
            <div className="flex items-end"><SubmitButton>Create branch</SubmitButton></div>
          </ActionForm>
        </Card>
      </PagePermission>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint={`${rows.length} branches`}>Branches</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Branch</Th><Th>Type</Th><Th>Contact</Th><Th className="text-right">Stock units</Th><Th className="text-right">Sales</Th><Th className="text-right">Revenue</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map(({ branch, stock, salesCount, revenue }) => (
                <Tr key={branch.id}>
                  <Td>
                    <span className="text-[12.5px] font-medium">{branch.name}</span>
                    <p className="font-mono text-[10.5px] muted">{branch.code}{branch.isDefault ? " · default" : ""}</p>
                  </Td>
                  <Td className="text-[11.5px] muted">{branch.type}</Td>
                  <Td className="text-[11px] muted">{branch.phone ?? "—"}<p className="max-w-[200px] truncate">{branch.address ?? ""}</p></Td>
                  <Td className="text-right tabular-nums">{formatNumber(Number(stock))}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(salesCount)}</Td>
                  <Td className="text-right tabular-nums">{formatCurrency(revenue, auth.tenant?.currency ?? "NGN")}</Td>
                  <Td><Badge tone={branch.isActive ? "success" : "neutral"}>{branch.isActive ? "Active" : "Closed"}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
