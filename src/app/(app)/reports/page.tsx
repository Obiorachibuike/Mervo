import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Download, LineChart as LineIcon, PieChart, TrendingUp } from "lucide-react";
import { getDb } from "@/server/db";
import { businesses } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { PageBody, SectionTitle } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/form";
import { LinkButton } from "@/components/ui/link-button";
import { BarChart, Donut, LineChart } from "@/components/charts";
import { PrintButton } from "@/components/ui/print-button";
import {
  branchPerformance,
  businessSnapshot,
  expenseSummary,
  forecastFromSeries,
  generateBusinessReport,
  rangeFromDays,
  salesByDay,
  salesByPaymentMethod,
  salesSummary,
  topProducts,
} from "@/server/services/reports";
import { formatCurrency, formatNumber, shortDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const PALETTE = ["#20B26B", "#39FF14", "#101418", "#6B7A75", "#A9B8B2", "#0E7A4A"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const days = Number(params.days ?? 30);
  const range = rangeFromDays(Number.isFinite(days) ? days : 30);
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const [summary, series, products, branches, payments, snapshot, expenses, report] = await Promise.all([
    salesSummary(db, auth.tenantId, range),
    salesByDay(db, auth.tenantId, range),
    topProducts(db, auth.tenantId, range, 10),
    branchPerformance(db, auth.tenantId, range),
    salesByPaymentMethod(db, auth.tenantId, range),
    businessSnapshot(db, auth.tenantId),
    expenseSummary(db, auth.tenantId, range),
    generateBusinessReport(db, auth.tenantId, days),
  ]);

  const forecast = forecastFromSeries(series, 14);
  const best = [...series].sort((a, b) => Number(b.total) - Number(a.total))[0];

  return (
    <>
      <Topbar title="Reports" subtitle="Deterministic analytics — every number is computed from your ledger" actions={<PrintButton label="Print" />} />
      <PageBody>
        <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Field label="Period">
              <Select name="days" defaultValue={String(days)}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="180">Last 6 months</option>
                <option value="365">Last 12 months</option>
              </Select>
            </Field>
            <SubmitButton variant="outline">Apply</SubmitButton>
          </form>
          <div className="flex items-center gap-2">
            <Badge tone="success">Actual</Badge>
            <span className="text-[11.5px] muted">{shortDate(range.from)} → {shortDate(range.to)}</span>
            <LinkButton href={`/api/reports/export?days=${days}`} variant="outline" size="sm">
              <Download className="size-3.5" /> Export CSV
            </LinkButton>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Gross sales" value={formatCurrency(summary.gross, currency)} hint={`${summary.count} transactions`} icon={<TrendingUp className="size-4" />} />
          <StatCard label="Net revenue" value={formatCurrency(summary.netRevenue, currency)} hint={`Avg basket ${formatCurrency(summary.averageBasket, currency)}`} tone="positive" />
          <StatCard label="Gross profit" value={formatCurrency(summary.grossProfit, currency)} hint={`${summary.margin}% margin`} tone="positive" />
          <StatCard label="Units sold" value={formatNumber(Number(summary.unitsSold))} hint={best ? `Best day ${shortDate(new Date(best.day))}` : undefined} icon={<LineIcon className="size-4" />} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-4">
            <SectionTitle hint="Daily revenue">Sales trend</SectionTitle>
            <div className="mt-3">
              <LineChart data={series.map((d) => ({ label: shortDate(new Date(d.day)), value: Number(d.total) }))} height={170} />
            </div>
            <div className="mt-2 flex justify-between text-[10.5px] muted">
              <span>{series[0] ? shortDate(new Date(series[0].day)) : ""}</span>
              <span>{series.at(-1) ? shortDate(new Date(series.at(-1)!.day)) : ""}</span>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle hint="Paid transactions">Payment mix</SectionTitle>
            <div className="mt-4">
              <Donut
                segments={payments.map((p, i) => ({ label: p.method, value: Number(p.total), color: PALETTE[i % PALETTE.length]! }))}
                centerLabel="Collected"
                centerValue={formatCurrency(payments.reduce((s, p) => s + Number(p.total), 0).toFixed(2), currency)}
              />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-0">
            <div className="p-4"><SectionTitle hint="Revenue">Top products</SectionTitle></div>
            <TableWrap>
              <Table>
                <thead><tr><Th>Product</Th><Th className="text-right">Units</Th><Th className="text-right">Revenue</Th><Th className="text-right">Share</Th></tr></thead>
                <tbody>
                  {products.map((p) => {
                    const share = Number(summary.gross) > 0 ? (Number(p.revenue) / Number(summary.gross)) * 100 : 0;
                    return (
                      <Tr key={p.productId ?? p.name}>
                        <Td className="text-[12px]">{p.name}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(Number(p.units))}</Td>
                        <Td className="text-right tabular-nums">{formatCurrency(p.revenue, currency)}</Td>
                        <Td className="text-right tabular-nums muted">{share.toFixed(1)}%</Td>
                      </Tr>
                    );
                  })}
                  {products.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No sales in this period.</Td></Tr> : null}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <Card className="p-4">
            <SectionTitle hint="Gross sales by branch">Branch performance</SectionTitle>
            <div className="mt-4">
              <BarChart data={branches.map((b) => ({ label: b.name, value: Number(b.gross) }))} currency={currency} height={150} />
            </div>
            <div className="mt-3 space-y-1.5 text-[12px]">
              {branches.map((b) => (
                <div key={b.branchId} className="flex items-center justify-between">
                  <span className="truncate">{b.name}</span>
                  <span className="tabular-nums muted">{formatCurrency(b.gross, currency)} · {b.count} sales</span>
                </div>
              ))}
              {branches.length === 0 ? <p className="muted">No branch activity yet.</p> : null}
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <SectionTitle hint="Ordinary least squares + weekday seasonality · estimate">14-day sales forecast</SectionTitle>
          <div className="mt-3">
            <BarChart
              data={[
                ...series.slice(-7).map((d) => ({ label: shortDate(new Date(d.day)), value: Number(d.total) })),
                ...forecast.points.slice(0, 7).map((p) => ({ label: shortDate(new Date(p.day)), value: Number(p.amount) })),
              ]}
              currency={currency}
              height={140}
            />
          </div>
          <p className="mt-3 text-[11.5px] muted">
            Projected next 14 days: <span className="font-medium text-[var(--fg)]">{formatCurrency(forecast.expectedTotal, currency)}</span>
            {" · "}trend {forecast.trend ?? "insufficient history"}{" · "}confidence {forecast.confidence}. Forecasts are estimates, not booked revenue.
          </p>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <SectionTitle>Business snapshot</SectionTitle>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <Row label="Inventory value" value={formatCurrency(snapshot.inventoryValue, currency)} />
              <Row label="Receivables" value={formatCurrency(snapshot.receivables.total, currency)} />
              <Row label="Payables" value={formatCurrency(snapshot.payables.total, currency)} />
              <Row label="Low stock items" value={formatNumber(snapshot.lowStockCount)} />
              <Row label="30-day net profit" value={formatCurrency(snapshot.profit.netProfit, currency)} />
            </dl>
          </Card>
          <Card className="p-4">
            <SectionTitle hint={`${expenses.count} entries`}>Expenses</SectionTitle>
            <p className="mt-3 text-2xl font-semibold tracking-tight">{formatCurrency(expenses.total, currency)}</p>
            <div className="mt-3 space-y-1.5 text-[12px]">
              {expenses.byCategory.map((m) => (
                <Row key={m.label} label={m.label} value={formatCurrency(m.total, currency)} />
              ))}
              {expenses.byCategory.length === 0 ? <p className="muted">No expenses recorded.</p> : null}
            </div>
          </Card>
          <Card className="p-4">
            <SectionTitle hint="Generated from actuals">Executive summary</SectionTitle>
            <ul className="mt-3 space-y-2 text-[12px] text-charcoal/70 dark:text-white/70">
              <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{report.headline}</li>
              <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{report.reconciliation.revenueVsGrossProfit}</li>
              <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{report.customers.totalCustomers} customers, {report.customers.loyal} loyal, {report.customers.atRisk} at risk.</li>
              <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{report.restock.length} products need restocking.</li>
              <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />Forecast for the next 30 days: {formatCurrency(report.forecast.expectedTotal, currency)}.</li>
            </ul>
            <div className="mt-3 flex items-center gap-1.5 text-[10.5px] muted"><PieChart className="size-3.5" /> Generated {shortDate(report.generatedAt)} · ledger {report.reconciliation.ledgerBalanced ? "balanced" : "unbalanced"}</div>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="muted capitalize">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
