import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { getDb } from "@/server/db";
import { listPlans } from "@/server/services/subscriptions";
import { MarketingFooter, MarketingNav } from "@/components/marketing/nav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Transparent MERVO pricing for single stores, multi-branch retail and enterprise operations. Start free, upgrade when you grow.",
};

export const revalidate = 300;

export default async function PricingPage() {
  const db = await getDb();
  const plans = await listPlans(db);

  return (
    <div className="min-h-screen bg-[#F6F8F7] dark:bg-charcoal">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">Pricing</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Pay for the size of your business</h1>
          <p className="mt-3 text-[14px] leading-relaxed muted">
            Every plan includes the POS, inventory, double-entry accounting and the AI assistant. No setup fees, no per-receipt charges, cancel anytime.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {plans.map((plan) => {
            const featured = plan.code === "growth";
            return (
              <Card key={plan.id} className={`flex flex-col p-5 ${featured ? "ring-2 ring-brand" : ""}`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-[14px] font-semibold">{plan.name}</h2>
                  {featured ? <Badge tone="neon">Popular</Badge> : plan.code === "enterprise" ? <Badge tone="neutral">Custom</Badge> : null}
                </div>
                <p className="mt-1 min-h-[32px] text-[11.5px] muted">{plan.description}</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {Number(plan.priceMonthly) === 0 ? "Free" : formatCurrency(plan.priceMonthly, plan.currency)}
                  {Number(plan.priceMonthly) > 0 ? <span className="text-[11px] font-normal muted">/mo</span> : null}
                </p>
                <p className="text-[10.5px] muted">
                  {plan.trialDays > 0 ? `${plan.trialDays}-day trial · ` : ""}
                  {plan.limits.branches < 0 ? "Unlimited branches" : `${plan.limits.branches} branch${plan.limits.branches === 1 ? "" : "es"}`}
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-[11.5px]">
                  {plan.features.slice(0, 6).map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-brand" />{feature}</li>
                  ))}
                </ul>
                <LinkButton href="/register" variant={featured ? "secondary" : "outline"} size="sm" className="mt-4 w-full">
                  Start with {plan.name} <ArrowRight className="size-3.5" />
                </LinkButton>
              </Card>
            );
          })}
        </div>

        <Card className="mt-10 p-6">
          <h2 className="text-[15px] font-semibold">What every plan includes</h2>
          <div className="mt-4 grid gap-4 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["POS & receipts", "Barcode/QR scanning, split payments, refunds, offline mode, printable receipts."],
              ["Inventory", "Weighted-average costing, transfers, purchase orders, low-stock alerts, shrinkage signals."],
              ["Accounting", "Double-entry ledger, trial balance, P&L, balance sheet, cash flow, immutable audit trail."],
              ["AI assistant", "Verified SQL tools for sales, profit, stock, customers, branches and forecasts."],
              ["CRM & loyalty", "Segments, credit balances, purchase history, marketing consent tracking."],
              ["Team & payroll", "Roles and granular permissions, shifts, attendance, payroll runs, leave."],
              ["Restaurant", "Floor plan, kitchen display, menu, reservations, online orders."],
              ["Storefront", "A public shop front that shares real stock and creates real sales."],
            ].map(([title, body]) => (
              <div key={title}>
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-[11.5px] muted">{body}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["Can I change plans?", "Yes — upgrade or downgrade any time from Settings → Billing. Usage limits apply immediately."],
            ["Which currencies?", "NGN, USD, EUR and GBP. Currency is per workspace and every amount is decimal-safe."],
            ["Do you support multiple branches?", "Growth and above include multi-branch stock, transfers, staff assignment and per-branch reporting."],
          ].map(([question, answer]) => (
            <Card key={question} className="p-4">
              <p className="text-[12.5px] font-medium">{question}</p>
              <p className="mt-1 text-[11.5px] muted">{answer}</p>
            </Card>
          ))}
        </div>

        <p className="mt-8 text-center text-[12px] muted">
          Questions about enterprise? <Link href="/register" className="font-medium text-brand">Create a workspace</Link> and our team will reach out.
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
