import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Check, CreditCard, ShieldCheck, TriangleAlert } from "lucide-react";
import { getDb } from "@/server/db";
import { billingEvents } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { ActionButton } from "@/components/ui/action-form";
import { cancelPlanAction, changePlanAction, resumePlanAction } from "@/server/actions/team";
import { billingHistory, getSubscription, listPlans, usageCounts } from "@/server/services/subscriptions";
import { formatCurrency, shortDate, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [current, plans, usage, history] = await Promise.all([
    getSubscription(db, auth.tenantId),
    listPlans(db),
    usageCounts(db, auth.tenantId),
    billingHistory(db, auth.tenantId),
  ]);
  const currency = current?.plan.currency ?? "NGN";
  const events = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.tenantId, auth.tenantId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(10)
    .catch(() => []);

  const limits = current?.plan.limits;
  const usageRows = limits
    ? [
        { label: "Branches", used: usage.branches, limit: limits.branches },
        { label: "Team members", used: usage.users, limit: limits.users },
        { label: "Products", used: usage.products, limit: limits.products },
        { label: "Automations", used: usage.automations, limit: limits.automations },
        { label: "AI tokens", used: usage.aiTokens, limit: limits.aiTokens },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current plan" value={current?.plan.name ?? "Free"} hint={current ? titleCase(current.subscription.status) : "No subscription"} icon={<CreditCard className="size-4" />} />
        <StatCard label="Price" value={current ? formatCurrency(current.subscription.interval === "yearly" ? current.plan.priceYearly : current.plan.priceMonthly, currency) : "—"} hint={current?.subscription.interval} />
        <StatCard label="Period ends" value={current?.subscription.currentPeriodEnd ? shortDate(current.subscription.currentPeriodEnd) : "—"} hint={current?.subscription.cancelAtPeriodEnd ? "Cancels at period end" : "Auto-renews"} tone={current?.subscription.cancelAtPeriodEnd ? "warning" : "default"} />
        <StatCard label="Payment gateway" value={titleCase(current?.subscription.gateway ?? "manual")} hint="Paystack · Flutterwave · Stripe" icon={<ShieldCheck className="size-4" />} />
      </div>

      <Card className="p-4">
        <SectionTitle hint="Plan limits are enforced server-side">Usage against your plan</SectionTitle>
        <div className="mt-3 space-y-2">
          {usageRows.map((row) => {
            const pct = row.limit < 0 ? 0 : Math.min(100, (row.used / Math.max(1, row.limit)) * 100);
            return (
              <div key={row.label}>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span>{row.label}</span>
                  <span className="tabular-nums muted">{row.used} / {row.limit < 0 ? "unlimited" : row.limit}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                  <div className={`h-full rounded-full ${pct >= 90 ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${row.limit < 0 ? 8 : Math.max(2, pct)}%` }} />
                </div>
              </div>
            );
          })}
          {usageRows.length === 0 ? <p className="text-[11.5px] muted">No plan limits available.</p> : null}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const active = current?.plan.code === plan.code;
          return (
            <Card key={plan.id} className={`p-4 ${active ? "ring-2 ring-brand/40" : ""}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-semibold">{plan.name}</p>
                  <p className="text-[11px] muted">{plan.description}</p>
                </div>
                {active ? <Badge tone="success">Current</Badge> : plan.code === "growth" ? <Badge tone="neon">Popular</Badge> : null}
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{formatCurrency(plan.priceMonthly, plan.currency)}<span className="text-[11px] font-normal muted">/mo</span></p>
              <ul className="mt-3 space-y-1 text-[11.5px]">
                {plan.features.slice(0, 5).map((feature) => (
                  <li key={feature} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 text-brand" />{feature}</li>
                ))}
              </ul>
              {!active ? (
                <div className="mt-3 flex gap-1.5">
                  <ActionButton action={changePlanAction} payload={{ planCode: plan.code, interval: "monthly" }} variant="secondary">Choose monthly</ActionButton>
                  <ActionButton action={changePlanAction} payload={{ planCode: plan.code, interval: "yearly" }} variant="outline">Yearly</ActionButton>
                </div>
              ) : current?.subscription.cancelAtPeriodEnd ? (
                <div className="mt-3"><ActionButton action={resumePlanAction} variant="secondary">Resume subscription</ActionButton></div>
              ) : (
                <div className="mt-3"><ActionButton action={cancelPlanAction} variant="outline" confirm="Cancel at the end of the current period?">Cancel renewal</ActionButton></div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Invoices and renewals">Billing history</SectionTitle></div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Date</Th><Th>Event</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
              <tbody>
                {history.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="text-[11px] muted">{shortDate(entry.createdAt)}</Td>
                    <Td className="text-[12px]">{titleCase(entry.type)}</Td>
                    <Td className="text-right tabular-nums">{formatCurrency(entry.amount, currency)}</Td>
                    <Td><Badge tone={entry.status === "succeeded" ? "success" : entry.status === "failed" ? "danger" : "warning"}>{titleCase(entry.status)}</Badge></Td>
                  </Tr>
                ))}
                {history.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No billing events yet — your plan is managed manually.</Td></Tr> : null}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card className="p-4">
          <SectionTitle hint="Signed webhooks only">Gateway events</SectionTitle>
          <ul className="mt-3 space-y-1.5 text-[11.5px]">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{event.gateway} · {titleCase(event.type || event.eventId)}</span>
                <Badge tone={event.status === "processed" ? "success" : event.status === "failed" ? "danger" : "warning"}>{titleCase(event.status)}</Badge>
              </li>
            ))}
            {events.length === 0 ? <li className="muted">No gateway events received yet.</li> : null}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] muted">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Webhooks are signature-verified and de-duplicated by provider event id, so a replayed request can never bill twice.
          </p>
        </Card>
      </div>
    </div>
  );
}
