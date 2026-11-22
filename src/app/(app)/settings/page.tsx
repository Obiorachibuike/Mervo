import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Building2, Percent, ReceiptText } from "lucide-react";
import { getDb } from "@/server/db";
import { businesses, plans, subscriptions, tenants } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { updateBusinessAction } from "@/server/actions/team";
import { formatCurrency, shortDate, titleCase } from "@/lib/utils";
import { tenantScope } from "@/server/db";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantScope(auth.tenantId))).limit(1);
  const [row] = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, auth.tenantId))
    .limit(1);

  const currency = business?.currency ?? "NGN";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Workspace" value={tenant?.name ?? "—"} hint={`Slug: ${tenant?.slug ?? "—"}`} icon={<Building2 className="size-4" />} />
        <StatCard label="Plan" value={row?.plan.name ?? "Free"} hint={row ? `${row.subscription.status} · ${row.subscription.interval}` : "No subscription"} />
        <StatCard label="VAT" value={`${Number(business?.taxRate ?? 0)}%`} hint={business?.taxInclusive ? "Prices include tax" : "Tax added at checkout"} icon={<Percent className="size-4" />} />
        <StatCard label="Renews" value={row?.subscription.currentPeriodEnd ? shortDate(row.subscription.currentPeriodEnd) : "—"} hint={row ? formatCurrency(row.subscription.interval === "yearly" ? row.plan.priceYearly : row.plan.priceMonthly, currency) : undefined} />
      </div>

      <Card className="p-4">
        <SectionTitle hint="Appears on receipts and storefront">Business profile</SectionTitle>
        <ActionForm action={updateBusinessAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Business name *"><Input name="name" required defaultValue={business?.name ?? ""} /></Field>
          <Field label="Legal name"><Input name="legalName" defaultValue={business?.legalName ?? ""} /></Field>
          <Field label="Industry">
            <Select name="industry" defaultValue={business?.industry ?? "retail"}>
              {["retail", "restaurant", "pharmacy", "supermarket", "fashion", "electronics", "services", "wholesale"].map((industry) => (
                <option key={industry} value={industry}>{titleCase(industry)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={business?.email ?? ""} /></Field>
          <Field label="Phone"><Input name="phone" defaultValue={business?.phone ?? ""} /></Field>
          <Field label="City"><Input name="city" defaultValue={business?.city ?? ""} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={business?.address ?? ""} /></Field>
          <Field label="Currency">
            <Select name="currency" defaultValue={business?.currency ?? "NGN"}>
              <option value="NGN">NGN — Nigerian Naira</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — Pound Sterling</option>
            </Select>
          </Field>
          <Field label="Tax rate %"><Input name="taxRate" type="number" step="0.001" min="0" max="100" defaultValue={business?.taxRate ?? "7.5"} /></Field>
          <label className="flex items-center gap-2 self-end text-[12px]">
            <input type="checkbox" name="taxInclusive" defaultChecked={business?.taxInclusive} className="size-4 rounded border-[var(--border)]" /> Prices already include tax
          </label>
          <Field label="Receipt footer" className="sm:col-span-2 lg:col-span-3">
            <Textarea name="receiptFooter" rows={2} defaultValue={business?.receiptFooter ?? "Thank you for your business."} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3"><SubmitButton>Save profile</SubmitButton></div>
        </ActionForm>
      </Card>

      <Card className="p-4">
        <SectionTitle hint="Read-only">Workspace identifiers</SectionTitle>
        <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3">
          <div><dt className="muted">Tenant ID</dt><dd className="font-mono text-[11px]">{auth.tenantId}</dd></div>
          <div><dt className="muted">Status</dt><dd><Badge tone={tenant?.status === "active" ? "success" : "warning"}>{titleCase(tenant?.status ?? "active")}</Badge></dd></div>
          <div><dt className="muted">Created</dt><dd>{tenant ? shortDate(tenant.createdAt) : "—"}</dd></div>
        </dl>
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] muted"><ReceiptText className="size-3.5" /> Every record in this workspace is scoped by tenant_id and enforced with Postgres row-level security.</p>
      </Card>
    </div>
  );
}
