import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  BrainCircuit,
  Building2,
  ChefHat,
  CreditCard,
  Globe2,
  Landmark,
  Lock,
  ScanBarcode,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  WifiOff,
  Zap,
} from "lucide-react";
import { MarketingFooter, MarketingNav } from "@/components/marketing/nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineChart, Donut } from "@/components/charts";

const MODULES = [
  { icon: ScanBarcode, title: "Smart POS & checkout", body: "Barcode/QR scanning, variants, split payments, discounts, credit sales, refunds and printed receipts — keyboard or touch." },
  { icon: Boxes, title: "AI inventory", body: "Atomic stock ledger, transfers, purchase orders, batch and expiry tracking, demand forecasting and reorder advice." },
  { icon: BrainCircuit, title: "AI business analyst", body: "Ask “what was my net profit yesterday?” and get answers computed from your ledger by authorised backend tools." },
  { icon: Landmark, title: "Double-entry finance", body: "Every sale and expense posts balanced journal entries. P&L, balance sheet, cash flow, receivables and payables." },
  { icon: Users, title: "Customers & loyalty", body: "Profiles, purchase history, loyalty points, credit limits, churn risk and consent-aware WhatsApp/email campaigns." },
  { icon: Building2, title: "Multi-branch control", body: "Per-branch stock, pricing and staff with granular roles, branch scoping and a full audit trail." },
  { icon: ChefHat, title: "Restaurant & hospitality", body: "Tables, QR menus, kitchen display, modifiers, recipes, reservations and service charges." },
  { icon: ShoppingBag, title: "E-commerce", body: "A publishable storefront per business sharing the same inventory and ledger as the physical shop." },
  { icon: WifiOff, title: "Offline-first POS", body: "Queue sales in IndexedDB during outages and sync automatically with idempotency keys — never duplicate a sale." },
  { icon: CreditCard, title: "Payments", body: "Cash, transfer, card terminal, Paystack, Flutterwave and Stripe with server-verified webhooks." },
  { icon: Zap, title: "Automation engine", body: "Scheduled and event-driven rules: low-stock alerts, daily briefs, expense thresholds, refund monitoring." },
  { icon: ShieldCheck, title: "Governance", body: "Tenant isolation at every query, immutable ledgers, granular permissions, session revocation and audit logs." },
];

const INDUSTRIES = ["Supermarkets", "Grocery", "Restaurants", "Pharmacies", "Electronics", "Phone accessories", "Fashion", "Wholesale", "Distributors", "Hotels", "Multi-location retail"];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <MarketingNav transparent />

      {/* ───────────────────────────── hero ───────────────────────────── */}
      <section className="relative overflow-hidden pt-28">
        <div className="absolute inset-0 grid-lines opacity-70" aria-hidden />
        <div className="absolute -left-40 top-20 h-80 w-80 rounded-full bg-brand/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-5">
          <Badge tone="neutral" className="border border-[var(--border)] bg-[var(--bg-elevated)]">
            <span className="h-1.5 w-1.5 rounded-full bg-neon" /> MERVO · Intelligent Business Management OS
          </Badge>
          <h1 className="mt-6 max-w-4xl text-[44px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-[76px]">
            Run the whole business
            <br />
            from one<span className="text-brand">.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed muted">
            MERVO unifies sales, inventory, money, staff and customers — then puts an AI analyst on top that answers with
            your real numbers. Built for single shops and multi-branch groups alike.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/register">
              <Button size="lg">
                Start free <ArrowRight size={16} />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Explore the demo workspace
              </Button>
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] muted">
            <span className="inline-flex items-center gap-1.5"><Lock size={12} /> Tenant-isolated by design</span>
            <span className="inline-flex items-center gap-1.5"><Globe2 size={12} /> NGN · USD · EUR · GBP</span>
            <span className="inline-flex items-center gap-1.5"><WifiOff size={12} /> Works through outages</span>
          </div>

          {/* product preview */}
          <div className="relative mt-14 rounded-2xl border bg-[var(--bg-elevated)] p-2 shadow-pop">
            <div className="rounded-xl border bg-[var(--bg)] p-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  <span className="ml-3 muted">mervo.app/dashboard</span>
                </div>
                <Badge tone="success">Live ledger</Badge>
              </div>
              <div className="grid gap-3 py-4 sm:grid-cols-4">
                {[
                  { label: "Revenue today", value: "₦482,900", hint: "+12.4% vs yesterday" },
                  { label: "Gross profit", value: "₦138,200", hint: "28.6% margin" },
                  { label: "Net profit", value: "₦96,450", hint: "after expenses" },
                  { label: "Stock value", value: "₦18.4M", hint: "at weighted cost" },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-lg border bg-[var(--bg-elevated)] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide muted">{kpi.label}</p>
                    <p className="mt-1 text-lg font-semibold tracking-tight">{kpi.value}</p>
                    <p className="text-[10px] text-brand">{kpi.hint}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
                <div className="rounded-lg border bg-[var(--bg-elevated)] p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">Sales trend · 30 days</p>
                    <Badge tone="neutral">actual</Badge>
                  </div>
                  <LineChart
                    data={[62, 71, 66, 88, 74, 96, 83, 91, 105, 98, 112, 104, 121, 118, 133, 126, 140, 131, 148, 155, 143, 162, 158, 171, 166, 182, 175, 191, 186, 204].map((v, i) => ({ label: String(i), value: v }))}
                    height={132}
                    className="mt-3"
                  />
                </div>
                <div className="rounded-lg border bg-[var(--bg-elevated)] p-3">
                  <p className="text-xs font-medium">Payment mix</p>
                  <div className="mt-3">
                    <Donut
                      segments={[
                        { label: "Cash", value: 42, color: "#20B26B" },
                        { label: "Transfer", value: 33, color: "#101418" },
                        { label: "Card", value: 25, color: "#39FF14" },
                      ]}
                      centerValue="3,412"
                      centerLabel="txns"
                      size={104}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-brand/30 bg-brand/5 p-3">
                <p className="flex items-center gap-2 text-xs font-medium">
                  <Sparkles size={13} className="text-brand" /> MERVO AI
                </p>
                <p className="mt-1 text-[11px] leading-relaxed muted">
                  “Sales are up 12.4% week over week. Two fast movers (Rice 5kg, 20W Charger) will run out in under 3 days
                  at current velocity — order 40 and 25 units. Net profit is ₦96,450 after ₦41,750 of expenses.”
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────── platform ───────────────────────── */}
      <section id="platform" className="mx-auto max-w-6xl px-5 py-24">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] muted">The platform</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">
              Twelve systems. One source of truth.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed muted">
            Most POS tools stop at the receipt. MERVO keeps the whole operating picture — stock, cash, people and
            decisions — wired together and always consistent.
          </p>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.title} className="group bg-[var(--bg-elevated)] p-6 transition-colors hover:bg-[var(--bg)]">
              <m.icon size={18} className="text-brand" />
              <h3 className="mt-4 text-sm font-semibold">{m.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed muted">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────────── AI ─────────────────────────────── */}
      <section id="ai" className="border-y bg-charcoal text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neon">MERVO AI</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">
              An analyst that never invents a number.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              The assistant answers through authorised backend tools — <span className="font-mono text-[12px] text-white/80">get_sales_summary</span>,{" "}
              <span className="font-mono text-[12px] text-white/80">get_profit_summary</span>,{" "}
              <span className="font-mono text-[12px] text-white/80">forecast_sales</span> and more. Financial math happens in
              deterministic services, so figures reconcile with your ledger, and estimates are labelled as estimates.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-white/70">
              {[
                "Agnes AI as primary provider, OpenAI and Hugging Face as fallbacks",
                "Per-task model assignment, quotas and spend limits in Super Admin",
                "Works even with no provider configured — deterministic analytics answer anyway",
                "Every answer is tenant-scoped and permission-checked",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neon" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            {[
              { q: "How much did I sell today, and what was my net profit?", a: "Gross sales ₦482,900 across 164 transactions. Net profit ₦96,450 after ₦41,750 expenses and ₦138,200 gross profit." },
              { q: "What should I restock before the weekend?", a: "Rice 5kg — 9 left, 1.8 days cover → order 40 (₦276,000). 20W Charger — 14 left → order 25 (₦95,000)." },
              { q: "Compare my branches this month.", a: "Main: ₦4.21M from 1,284 sales (27.9% margin). Lekki: ₦2.49M from 702 sales (29.4% margin)." },
            ].map((row) => (
              <div key={row.q} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs font-medium text-white/90">{row.q}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-white/55">{row.a}</p>
              </div>
            ))}
            <p className="pl-1 text-[10px] text-white/35">Illustrative answers. Your workspace uses your live ledger.</p>
          </div>
        </div>
      </section>

      {/* ───────────────────────────── finance ───────────────────────── */}
      <section id="finance" className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="order-2 lg:order-1">
            <div className="rounded-xl border bg-[var(--bg-elevated)] p-5 shadow-card">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Profit &amp; loss</p>
                <Badge tone="success">ledger-verified</Badge>
              </div>
              <dl className="mt-4 space-y-2 text-xs">
                {[
                  ["Revenue", "₦6,040,050.00", "text-[var(--fg)]"],
                  ["Cost of goods sold", "(₦4,302,204.00)", "text-red-600 dark:text-red-400"],
                  ["Gross profit", "₦1,737,846.00", "text-brand"],
                  ["Operating expenses", "(₦290,000.00)", "text-red-600 dark:text-red-400"],
                  ["Net profit", "₦1,447,846.00", "text-brand font-semibold"],
                  ["Tax collected (payable)", "₦421,140.00", "muted"],
                ].map(([label, value, cls]) => (
                  <div key={label as string} className="flex items-center justify-between border-b pb-1.5">
                    <dt className="muted">{label}</dt>
                    <dd className={cls as string}>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[10px] muted">
                Revenue ≠ gross profit ≠ net profit. MERVO never conflates them.
              </p>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] muted">Finance</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">Books that close themselves.</h2>
            <p className="mt-4 text-sm leading-relaxed muted">
              Each sale, refund and expense writes a balanced double-entry journal with decimal-safe arithmetic. Inventory,
              tax, receivables and COGS stay in sync automatically — so month-end is a review, not a rebuild.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
              {["Trial balance", "P&L", "Balance sheet", "Cash flow", "Receivables", "Payables", "Tax report", "Period close"].map((f) => (
                <div key={f} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" /> {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────── industries ─────────────────────── */}
      <section id="industries" className="border-y bg-[var(--bg-elevated)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] muted">Industries</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-[38px]">Configured to how you actually sell.</h2>
            </div>
            <p className="max-w-sm text-sm muted">Vertical modules switch on per business: retail catalogue, restaurant floor or pharmacy batches.</p>
          </div>
          <div className="mt-10 flex flex-wrap gap-2">
            {INDUSTRIES.map((industry) => (
              <span key={industry} className="rounded-full border px-4 py-2 text-xs">
                {industry}
              </span>
            ))}
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { icon: ChefHat, title: "Restaurant", body: "Tables, QR ordering, KDS, modifiers, recipes and service charges." },
              { icon: BarChart3, title: "Multi-branch", body: "Per-branch stock, transfers, staff scoping and branch P&L." },
              { icon: ShoppingBag, title: "E-commerce", body: "Publish a storefront with shared inventory and online checkout." },
            ].map((c) => (
              <div key={c.title} className="rounded-xl border bg-[var(--bg)] p-5">
                <c.icon size={16} className="text-brand" />
                <p className="mt-3 text-sm font-semibold">{c.title}</p>
                <p className="mt-1 text-xs muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────────── security ───────────────────────── */}
      <section id="security" className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] muted">Security & data</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">
              Your numbers stay yours.
            </h2>
            <p className="mt-4 text-sm leading-relaxed muted">
              Every query is tenant-scoped in the service layer, ledgers are append-only at the database level, and
              privileged actions are audited. Provider API keys are encrypted with AES-256-GCM and never reach the browser.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Tenant isolation", "Every read/write filtered by workspace id."],
              ["Immutable ledgers", "Database triggers reject edits to stock and journal history."],
              ["Granular RBAC", "11 roles, 27 permissions, branch scoping."],
              ["Server-side authz", "Permissions enforced in services, never UI-only."],
              ["Verified webhooks", "HMAC signatures checked before billing changes."],
              ["Audit trail", "Who did what, from where, when."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl border bg-[var(--bg-elevated)] p-4">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <ShieldCheck size={13} className="text-brand" /> {title}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────────── CTA ───────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="relative overflow-hidden rounded-2xl bg-charcoal px-8 py-14 text-white">
          <div className="absolute inset-0 grid-lines opacity-10" aria-hidden />
          <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <h2 className="max-w-lg text-3xl font-semibold leading-tight tracking-[-0.03em]">
                Start on Free. Grow into everything else.
              </h2>
              <p className="mt-2 max-w-md text-sm text-white/60">
                Free for one branch and one terminal, with AI insights included. Upgrade when you add staff, branches or
                e-commerce.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/register">
                <Button size="lg" variant="neon">
                  Create workspace <ArrowRight size={16} />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button size="lg" variant="ghost" className="text-white hover:bg-white/10">
                  Compare plans
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
