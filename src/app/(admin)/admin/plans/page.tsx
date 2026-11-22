import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { listPlans } from "@/server/services/subscriptions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, SectionTitle } from "@/components/ui/page";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { savePlanAction } from "@/server/actions/platform";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function AdminPlansPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const params = await searchParams;
  const db = await getDb();
  const plans = await listPlans(db, true);
  const editing = plans.find((plan) => plan.code === params.edit);

  return (
    <div className="space-y-4">
      <PageHeader title="Subscription plans" description="Plans, prices and hard limits. Changes take effect immediately for every workspace." />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-0">
          <div className="p-4"><SectionTitle hint={`${plans.length} plans`}>Catalogue</SectionTitle></div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Plan</Th><Th className="text-right">Monthly</Th><Th className="text-right">Yearly</Th><Th className="text-right">Branches</Th><Th className="text-right">Users</Th><Th>Status</Th></tr></thead>
              <tbody>
                {plans.map((plan) => (
                  <Tr key={plan.id}>
                    <Td>
                      <a href={`/admin/plans?edit=${plan.code}`} className="text-[12.5px] font-medium hover:text-brand">{plan.name}</a>
                      <p className="font-mono text-[10.5px] muted">{plan.code}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{formatCurrency(plan.priceMonthly, plan.currency)}</Td>
                    <Td className="text-right tabular-nums">{formatCurrency(plan.priceYearly, plan.currency)}</Td>
                    <Td className="text-right tabular-nums">{plan.limits.branches < 0 ? "∞" : plan.limits.branches}</Td>
                    <Td className="text-right tabular-nums">{plan.limits.users < 0 ? "∞" : plan.limits.users}</Td>
                    <Td><Badge tone={plan.isActive ? "success" : "neutral"}>{plan.isActive ? "Active" : "Hidden"}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card className="p-4">
          <SectionTitle hint={editing ? `Editing ${editing.code}` : "New or update"}>Plan editor</SectionTitle>
          <ActionForm action={savePlanAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Code *"><Input name="code" required defaultValue={editing?.code ?? ""} readOnly={Boolean(editing)} /></Field>
            <Field label="Name *"><Input name="name" required defaultValue={editing?.name ?? ""} /></Field>
            <Field label="Monthly price"><Input name="priceMonthly" type="number" step="0.01" min="0" defaultValue={editing?.priceMonthly ?? "0"} /></Field>
            <Field label="Yearly price"><Input name="priceYearly" type="number" step="0.01" min="0" defaultValue={editing?.priceYearly ?? "0"} /></Field>
            <Field label="Currency">
              <Select name="currency" defaultValue={editing?.currency ?? "NGN"}>
                <option value="NGN">NGN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
              </Select>
            </Field>
            <Field label="Trial days"><Input name="trialDays" type="number" min="0" defaultValue={editing?.trialDays ?? 14} /></Field>
            <Field label="Branches (-1 unlimited)"><Input name="branches" type="number" defaultValue={editing?.limits.branches ?? 1} /></Field>
            <Field label="Users (-1 unlimited)"><Input name="users" type="number" defaultValue={editing?.limits.users ?? 3} /></Field>
            <Field label="Products"><Input name="products" type="number" defaultValue={editing?.limits.products ?? 200} /></Field>
            <Field label="AI tokens"><Input name="aiTokens" type="number" defaultValue={editing?.limits.aiTokens ?? 50000} /></Field>
            <Field label="Sort order"><Input name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} /></Field>
            <Field label="Status">
              <Select name="isActive" defaultValue={String(editing?.isActive ?? true)}>
                <option value="true">Active</option>
                <option value="false">Hidden</option>
              </Select>
            </Field>
            <Field label="Description" className="sm:col-span-2"><Input name="description" defaultValue={editing?.description ?? ""} /></Field>
            <Field label="Features (one per line)" className="sm:col-span-2"><Textarea name="features" rows={4} defaultValue={(editing?.features ?? []).join("\n")} /></Field>
            <div className="sm:col-span-2"><SubmitButton>{editing ? "Update plan" : "Create plan"}</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
