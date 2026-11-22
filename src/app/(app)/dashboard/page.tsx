import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  BrainCircuit,
  ChevronRight,
  PackageSearch,
  Plus,
  Receipt,
  ScanBarcode,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat";
import { BarChart, Donut, LineChart } from "@/components/charts";
import { EmptyState } from "@/components/ui/empty";
import { formatCurrency, formatNumber, relativeTime, titleCase } from "@/lib/utils";
import { activityFeed, branchPerformance, businessSnapshot, rangeFromDays, salesByDay } from "@/server/services/reports";
import { listInsights } from "@/server/ai/insights";
import { getSubscription } from "@/server/services/subscriptions";
import { recentSales } from "@/server/services/sales";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string; denied?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  const db = await getDb();
  const tenantId = auth!.tenantId!;
  const currency = auth!.tenant?.currency ?? "NGN";

  const [snapshot, insights, branches, feed, sales, sub, series] = await Promise.all([
    businessSnapshot(db, tenantId, auth!.branchId ?? undefined),
    listInsights(db, tenantId, 4),
    branchPerformance(db, tenantId, rangeFromDays(30)),
    activityFeed(db, tenantId, 6),
    recentSales(db, tenantId, { limit: 6 }),
    getSubscription(db, tenantId),
    salesByDay(db, tenantId, rangeFromDays(30)),
  ]);

  const trend = series.map((s) => ({ label: s.day.slice(5), value: Number(s.total) }));
  const methodColors = ["#20B26B", "#101418", "#39FF14", "#94A3B8", "#F59E0B"];
  const mix = snapshot.paymentMethods.map((m, i) => ({ label: titleCase(m.method), value: Number(m.total), color: methodColors[i % methodColors.length]! }));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <Topbar
        title={`${greeting}, ${auth!.user.name.split(" ")[0]}`}
        subtitle={`${auth!.tenant?.name} · ${sub?.plan.name ?? "Free"} plan${sub?.subscription.status === "trialing" ? " · trial" : ""}`}
        emailVerified={Boolean(auth!.user.mfaEnabled) || true}
        actions={
          <div className="hidden items-center gap-1.5 sm:flex">
            <Link href="/pos">
              <Button size="sm" variant="secondary">
                <ScanBarcode size={14} /> Open POS
              </Button>
            </Link>
            <Link href="/products?new=1">
              <Button size="sm" variant="outline">
                <Plus size={14} /> Product
              </Button>
            </Link>
          </div>
        }
      />
      <div className="space-y-5 p-4 sm:p-6">
        {params.welcome ? (
          <div className="rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 text-xs">
            <p className="font-medium text-brand-dark dark:text-brand">Your MERVO workspace is live.</p>
            <p className="mt-0.5 muted">Add products, invite your team and open the POS. Your trial includes every Growth capability.</p>
          </div>
        ) : null}
        {params.denied ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
            Your role does not include the <code className="font-mono">{params.denied}</code> permission. Ask an owner or administrator for access.
          </div>
        ) : null}

        {/* KPI row */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Sales today"
            value={formatCurrency(snapshot.today.gross, currency)}
            hint={`${snapshot.today.count} transactions · avg ${formatCurrency(snapshot.today.averageBasket, currency)}`}
            icon={<Receipt size={15} />}
          />
          <StatCard
            label="Gross profit (30d)"
            value={formatCurrency(snapshot.profit.grossProfit, currency)}
            hint={`${snapshot.profit.margins.gross}% margin · actual`}
            tone="positive"
            icon={<TrendingUp size={15} />}
          />
          <StatCard
            label="Net profit (30d)"
            value={formatCurrency(snapshot.profit.netProfit, currency)}
            hint={`after ${formatCurrency(snapshot.profit.expenses, currency)} expenses`}
            tone={Number(snapshot.profit.netProfit) >= 0 ? "positive" : "critical"}
            icon={<Wallet size={15} />}
          />
          <StatCard
            label="Stock value"
            value={formatCurrency(snapshot.inventoryValue, currency)}
            hint={`${snapshot.lowStockCount} item(s) need restocking`}
            tone={snapshot.lowStockCount > 0 ? "warning" : "default"}
            icon={<Boxes size={15} />}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Revenue trend</CardTitle>
                  <p className="mt-0.5 text-[11px] muted">Actual sales from the ledger · last 30 days</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{formatCurrency(snapshot.last30Days.gross, currency)}</p>
                  <Badge tone="success">{snapshot.last30Days.count} sales</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                {trend.length ? <LineChart data={trend} height={150} /> : <EmptyState title="No sales yet" description="Open the POS and process your first sale." className="border-0" />}
              </CardContent>
            </Card>

            <div className="grid gap-5 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top products</CardTitle>
                  <Link href="/reports" className="text-[11px] font-medium text-brand hover:underline">
                    Reports
                  </Link>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-3">
                  {snapshot.topProducts.length ? (
                    snapshot.topProducts.map((p) => (
                      <div key={p.productId ?? p.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="muted">{formatNumber(p.units)} u</span>
                        <span className="font-medium">{formatCurrency(p.revenue, currency)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-xs muted">No sales recorded yet.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Branch performance</CardTitle>
                  <Link href="/reports#branches" className="text-[11px] font-medium text-brand hover:underline">
                    Compare
                  </Link>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  <BarChart data={branches.map((b) => ({ label: b.name.replace(/^.*—\s*/, ""), value: Number(b.gross) }))} height={112} currency="" />
                  <div className="space-y-1.5">
                    {branches.slice(0, 3).map((b) => (
                      <div key={b.branchId} className="flex items-center justify-between text-[11px]">
                        <span className="truncate muted">{b.name}</span>
                        <span className="font-medium">{formatCurrency(b.gross, currency)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent sales</CardTitle>
                <Link href="/sales" className="text-[11px] font-medium text-brand hover:underline">
                  View all
                </Link>
              </CardHeader>
              <CardContent className="pt-3">
                {sales.length ? (
                  <ul className="divide-y">
                    {sales.map((sale) => (
                      <li key={sale.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                        <div className="min-w-0">
                          <Link href={`/receipt/${sale.id}`} className="font-medium hover:underline">
                            {sale.number}
                          </Link>
                          <p className="truncate text-[10px] muted">
                            {sale.branchName} · {sale.customerName ?? "Walk-in"} · {relativeTime(sale.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={sale.status === "completed" ? "success" : sale.status === "voided" ? "danger" : "warning"}>{titleCase(sale.status)}</Badge>
                          <span className="w-24 text-right font-medium">{formatCurrency(sale.total, currency)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No sales yet" description="Your first sale will appear here." className="border-0" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b bg-charcoal px-4 py-3 text-white">
                <Sparkles size={14} className="text-neon" />
                <p className="text-xs font-semibold">MERVO AI insights</p>
                <Link href="/ai" className="ml-auto text-[10px] text-white/60 hover:text-white">
                  Ask anything →
                </Link>
              </div>
              <div className="divide-y">
                {insights.length ? (
                  insights.map((insight) => (
                    <div key={insight.id} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {insight.severity === "critical" ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" /> : <BrainCircuit size={13} className="mt-0.5 shrink-0 text-brand" />}
                        <div className="min-w-0">
                          <p className="text-[11.5px] font-medium leading-snug">{insight.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed muted">{insight.body}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-6 text-center text-xs muted">Insights will appear as your business trades.</p>
                )}
              </div>
              <div className="border-t p-3">
                <Link href="/ai?q=Give%20me%20a%20full%20business%20report%20for%20the%20last%2030%20days">
                  <Button variant="outline" size="sm" className="w-full">
                    <BrainCircuit size={13} /> Generate business briefing
                  </Button>
                </Link>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Payment mix · 30 days</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {mix.length ? <Donut segments={mix} centerValue={formatNumber(snapshot.last30Days.count)} centerLabel="sales" size={112} /> : <p className="py-6 text-center text-xs muted">No payments yet.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
                <PackageSearch size={14} className="muted" />
              </CardHeader>
              <CardContent className="space-y-2.5 pt-3">
                {snapshot.lowStock.length ? (
                  snapshot.lowStock.map((item) => (
                    <div key={item.productId} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <Badge tone={Number(item.quantity) <= 0 ? "danger" : "warning"}>{formatNumber(item.quantity)} left</Badge>
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-center text-xs muted">All stock levels are healthy.</p>
                )}
                <div className="flex items-center justify-between border-t pt-2.5 text-[11px]">
                  <span className="muted">Customer credit outstanding</span>
                  <span className="font-medium">{formatCurrency(snapshot.receivables.total, currency)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="muted">Supplier debt</span>
                  <span className="font-medium">{formatCurrency(snapshot.payables.total, currency)}</span>
                </div>
                <Link href="/inventory" className="flex items-center gap-1 pt-1 text-[11px] font-medium text-brand hover:underline">
                  Manage inventory <ChevronRight size={12} />
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Live activity</CardTitle>
                <Users size={14} className="muted" />
              </CardHeader>
              <CardContent className="space-y-2 pt-3">
                {feed.sales.slice(0, 3).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate">
                      <span className="font-medium">{s.number}</span> <span className="muted">by {s.cashier ?? "staff"}</span>
                    </span>
                    <span className="muted">{relativeTime(s.createdAt)}</span>
                  </div>
                ))}
                {feed.movements.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate">
                      <span className="capitalize">{m.type}</span> <span className="muted">{m.productName}</span>
                    </span>
                    <span className={Number(m.qty) < 0 ? "text-red-500" : "text-brand"}>{m.qty}</span>
                  </div>
                ))}
                <Link href="/sales" className="flex items-center gap-1 pt-1 text-[11px] font-medium text-brand hover:underline">
                  Open activity <ArrowUpRight size={12} />
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
