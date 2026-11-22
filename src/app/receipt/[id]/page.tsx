import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sales as salesTable } from "@/server/db/schema";
import { buildReceipt } from "@/server/services/sales";
import { formatCurrency, dateTime } from "@/lib/utils";
import { MervoLogo } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { PrintButton } from "@/components/ui/print-button";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Public, shareable receipt. The sale id is an unguessable UUID, so the link works
 * as a verification token without exposing the workspace session.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  // the sale id resolves the owning workspace; the UUID itself is the access token
  const [sale] = await db.select({ tenantId: salesTable.tenantId }).from(salesTable).where(eq(salesTable.id, id)).limit(1);
  if (!sale) notFound();
  const receipt = await buildReceipt(db, sale.tenantId, id);
  if (!receipt) notFound();

  return (
    <main className="min-h-screen bg-[#F6F8F7] py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-lg px-4 print:max-w-none print:px-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <MervoLogo />
          <div className="flex gap-2">
            <LinkButton href="/dashboard" variant="outline" size="sm">Dashboard</LinkButton>
            <PrintButton />
          </div>
        </div>

        <article className="rounded-3xl border border-charcoal/10 bg-white p-6 shadow-card print:rounded-none print:border-0 print:shadow-none">
          <header className="border-b border-dashed border-charcoal/15 pb-4 text-center">
            <h1 className="text-xl font-semibold tracking-tight">{receipt.businessName}</h1>
            {receipt.address ? <p className="mt-1 text-xs text-charcoal/60">{receipt.address}</p> : null}
            {receipt.phone ? <p className="text-xs text-charcoal/60">{receipt.phone}</p> : null}
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-charcoal/40">{receipt.branchName}</p>
          </header>

          <dl className="grid grid-cols-2 gap-2 border-b border-dashed border-charcoal/15 py-4 text-xs">
            <div>
              <dt className="text-charcoal/50">Receipt</dt>
              <dd className="font-mono text-sm font-semibold">{receipt.number}</dd>
            </div>
            <div className="text-right">
              <dt className="text-charcoal/50">Date</dt>
              <dd>{dateTime(receipt.createdAt)}</dd>
            </div>
            {receipt.customerName ? (
              <div className="col-span-2">
                <dt className="text-charcoal/50">Customer</dt>
                <dd className="font-medium">{receipt.customerName}</dd>
              </div>
            ) : null}
          </dl>

          <table className="w-full py-2 text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-charcoal/40">
                <th className="py-2">Item</th>
                <th className="py-2 text-center">Qty</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((item, index) => (
                <tr key={`${item.name}-${index}`} className="border-t border-charcoal/5">
                  <td className="py-2 pr-2">
                    {item.name}
                    {item.modifiers.length ? <span className="block text-[10px] text-charcoal/50">{item.modifiers.join(", ")}</span> : null}
                  </td>
                  <td className="py-2 text-center tabular-nums">{Number(item.quantity).toFixed(Number(item.quantity) % 1 === 0 ? 0 : 2)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(item.lineTotal, receipt.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-3 space-y-1 border-t border-dashed border-charcoal/15 pt-3 text-xs">
            <Row label="Subtotal" value={formatCurrency(receipt.subtotal, receipt.currency)} />
            {Number(receipt.discountTotal) > 0 ? <Row label="Discount" value={`− ${formatCurrency(receipt.discountTotal, receipt.currency)}`} /> : null}
            {Number(receipt.taxTotal) > 0 ? <Row label="VAT" value={formatCurrency(receipt.taxTotal, receipt.currency)} /> : null}
            <div className="flex items-baseline justify-between border-t border-charcoal/15 pt-2 text-sm font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCurrency(receipt.total, receipt.currency)}</dd>
            </div>
            {receipt.payments.map((p) => (
              <Row key={p.method} label={`Paid · ${p.method}`} value={formatCurrency(p.amount, receipt.currency)} />
            ))}
            {Number(receipt.changeDue) > 0 ? <Row label="Change" value={formatCurrency(receipt.changeDue, receipt.currency)} /> : null}
            {Number(receipt.balanceDue) > 0 ? <Row label="Balance due" value={formatCurrency(receipt.balanceDue, receipt.currency)} /> : null}
          </dl>

          <footer className="mt-6 space-y-2 border-t border-dashed border-charcoal/15 pt-4 text-center">
            <Badge tone="success">Verified · MERVO</Badge>
            <p className="text-[11px] leading-relaxed text-charcoal/55">{receipt.footer ?? "Thank you for your business."}</p>
            <p className="break-all text-[10px] text-charcoal/35">{receipt.verifyUrl}</p>
          </footer>
        </article>
        <p className="mt-4 text-center text-[11px] text-charcoal/40 print:hidden">Powered by MERVO · AI-powered retail operating system</p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-charcoal/70">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
