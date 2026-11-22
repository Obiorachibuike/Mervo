import type { Metadata } from "next";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Banknote, BookOpenCheck, Receipt, Scale, Wallet } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, businesses, expenses, journalEntries } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, PageHeader, SectionTitle } from "@/components/ui/page";
import { PagePermission } from "@/components/shell/permission-gate";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { recordExpenseFromFormAction } from "@/server/actions/catalog";
import { balanceSheet, cashFlow, payables, profitAndLoss, receivables, trialBalance } from "@/server/services/finance";
import { formatCurrency, dateTime, shortDate, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const days = Number(params.days ?? 30);
  const period = { from: new Date(Date.now() - days * 86400000), to: new Date() };
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const [pnl, sheet, cash, tb, recv, pay, expenseRows, entryRows, branchRows] = await Promise.all([
    profitAndLoss(db, auth.tenantId, period),
    balanceSheet(db, auth.tenantId),
    cashFlow(db, auth.tenantId, period),
    trialBalance(db, auth.tenantId, period),
    receivables(db, auth.tenantId),
    payables(db, auth.tenantId),
    db
      .select({ expense: expenses, branchName: branches.name })
      .from(expenses)
      .leftJoin(branches, eq(branches.id, expenses.branchId))
      .where(and(eq(expenses.tenantId, auth.tenantId), gte(expenses.date, period.from), lte(expenses.date, period.to)))
      .orderBy(desc(expenses.date))
      .limit(25),
    db
      .select({ id: journalEntries.id, reference: journalEntries.entryNumber, memo: journalEntries.memo, date: journalEntries.date, source: journalEntries.referenceType })
      .from(journalEntries)
      .where(eq(journalEntries.tenantId, auth.tenantId))
      .orderBy(desc(journalEntries.date))
      .limit(12),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId)),
  ]);

  const expenseTotal = expenseRows.reduce((s, r) => s + Number(r.expense.amount), 0);

  return (
    <>
      <Topbar title="Finance" subtitle="Double-entry books, cash flow and expense control" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Revenue (net)" value={formatCurrency(pnl.revenue, currency)} hint={`${pnl.margins.gross}% gross margin`} tone="positive" icon={<Receipt className="size-4" />} />
          <StatCard label="Net profit" value={formatCurrency(pnl.netProfit, currency)} hint={`${pnl.margins.net}% net margin`} tone={Number(pnl.netProfit) >= 0 ? "positive" : "critical"} />
          <StatCard label="Cash + bank movement" value={formatCurrency(cash.net, currency)} hint={`Cash ${formatCurrency(cash.netCash, currency)}`} icon={<Wallet className="size-4" />} />
          <StatCard label="Ledger integrity" value={tb.balanced && sheet.balanced ? "Balanced" : "Out of balance"} hint={`Debits ${formatCurrency(tb.debitTotal, currency)}`} tone={tb.balanced ? "positive" : "critical"} icon={<Scale className="size-4" />} />
        </div>

        <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Field label="Period">
              <Select name="days" defaultValue={String(days)}>
                <option value="1">Today</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last 12 months</option>
              </Select>
            </Field>
            <SubmitButton variant="outline">Apply</SubmitButton>
          </form>
          <p className="text-[11.5px] muted">Every sale, refund, purchase and payroll run posts a balanced journal entry.</p>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <SectionTitle hint={`${shortDate(pnl.range.from)} → ${shortDate(pnl.range.to)}`}>Profit &amp; loss</SectionTitle>
            <dl className="mt-3 space-y-1.5 text-[12.5px]">
              <Line label="Revenue" value={formatCurrency(pnl.revenue, currency)} bold />
              <Line label="Less refunds" value={`− ${formatCurrency(pnl.refunds, currency)}`} />
              <Line label="Cost of goods sold" value={`− ${formatCurrency(pnl.costOfGoods, currency)}`} />
              <Line label="Gross profit" value={formatCurrency(pnl.grossProfit, currency)} bold />
              <Line label="Operating expenses" value={`− ${formatCurrency(pnl.expenses, currency)}`} />
              <div className="border-t border-[var(--border)] pt-1.5">
                <Line label="Net profit" value={formatCurrency(pnl.netProfit, currency)} bold />
              </div>
            </dl>
          </Card>

          <Card className="p-4">
            <SectionTitle hint={`As of ${shortDate(new Date())}`}>Balance sheet</SectionTitle>
            <dl className="mt-3 space-y-1.5 text-[12.5px]">
              <Line label="Total assets" value={formatCurrency(sheet.totalAssets, currency)} bold />
              <Line label="Total liabilities" value={formatCurrency(sheet.totalLiabilities, currency)} />
              <Line label="Retained earnings" value={formatCurrency(sheet.retainedEarnings, currency)} />
              <Line label="Total equity" value={formatCurrency(sheet.totalEquity, currency)} bold />
              <div className="flex items-center gap-2 pt-1.5">
                <Badge tone={sheet.balanced ? "success" : "danger"}>{sheet.balanced ? "Assets = Liabilities + Equity" : "Out of balance"}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 text-[11.5px] muted">
                <span>Receivable: {formatCurrency(recv.total, currency)}</span>
                <span>Payable: {formatCurrency(pay.total, currency)}</span>
              </div>
            </dl>
          </Card>
        </div>

        <PagePermission permission="finance.manage">
          <Disclosure title="Record an expense" description="Posts to operating expenses and reduces cash or bank immediately." cta="New expense">
            <ActionForm action={recordExpenseFromFormAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Description *"><Input name="description" required placeholder="Diesel for generator" /></Field>
              <Field label="Amount *"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
              <Field label="Paid from">
                <Select name="method" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="transfer">Transfer</option>
                </Select>
              </Field>
              <Field label="Branch">
                <Select name="branchId" defaultValue="">
                  <option value="">Workspace-wide</option>
                  {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Date"><Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
              <div className="flex items-end"><SubmitButton>Post expense</SubmitButton></div>
            </ActionForm>
          </Disclosure>
        </PagePermission>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-0">
            <div className="flex items-center justify-between p-4">
              <SectionTitle hint={`${expenseRows.length} entries`}>Expenses</SectionTitle>
              <span className="text-[12px] font-medium tabular-nums">{formatCurrency(expenseTotal.toFixed(2), currency)}</span>
            </div>
            <TableWrap>
              <Table>
                <thead><tr><Th>Date</Th><Th>Description</Th><Th>Branch</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {expenseRows.map(({ expense, branchName }) => (
                    <Tr key={expense.id}>
                      <Td className="whitespace-nowrap text-[11px] muted">{shortDate(expense.date)}</Td>
                      <Td className="text-[12px]">{expense.description}<p className="text-[10.5px] muted">{titleCase(expense.method)}</p></Td>
                      <Td className="text-[11px] muted">{branchName ?? "Workspace"}</Td>
                      <Td className="text-right tabular-nums">{formatCurrency(expense.amount, currency)}</Td>
                    </Tr>
                  ))}
                  {expenseRows.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No expenses recorded in this period.</Td></Tr> : null}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between p-4">
              <SectionTitle hint="Immutable">Recent journal entries</SectionTitle>
              <BookOpenCheck className="size-4 text-charcoal/40" />
            </div>
            <TableWrap>
              <Table>
                <thead><tr><Th>Reference</Th><Th>Memo</Th><Th>Source</Th><Th>Date</Th></tr></thead>
                <tbody>
                  {entryRows.map((entry) => (
                    <Tr key={entry.id}>
                      <Td className="font-mono text-[11px]">{entry.reference}</Td>
                      <Td className="max-w-[220px] truncate text-[12px]">{entry.memo}</Td>
                      <Td><Badge tone="neutral">{titleCase(entry.source ?? "manual")}</Badge></Td>
                      <Td className="whitespace-nowrap text-[11px] muted">{dateTime(entry.date)}</Td>
                    </Tr>
                  ))}
                  {entryRows.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No journal entries yet.</Td></Tr> : null}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </div>

        <Card className="p-0">
          <div className="flex items-center justify-between p-4">
            <SectionTitle hint={tb.balanced ? "Debits equal credits" : "Investigate imbalance"}>Trial balance</SectionTitle>
            <Badge tone={tb.balanced ? "success" : "danger"}>{tb.balanced ? "Balanced" : "Unbalanced"}</Badge>
          </div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Code</Th><Th>Account</Th><Th>Type</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></tr></thead>
              <tbody>
                {tb.rows.map((row) => (
                  <Tr key={row.code}>
                    <Td className="font-mono text-[11px]">{row.code}</Td>
                    <Td className="text-[12px]">{row.name}</Td>
                    <Td className="text-[11px] muted">{titleCase(row.type)}</Td>
                    <Td className="text-right tabular-nums">{formatCurrency(row.debit, currency)}</Td>
                    <Td className="text-right tabular-nums">{formatCurrency(row.credit, currency)}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatCurrency(row.balance, currency)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-black/[0.02] text-[12px] font-semibold dark:bg-white/[0.03]">
                  <Td colSpan={3}>Totals</Td>
                  <Td className="text-right tabular-nums">{formatCurrency(tb.debitTotal, currency)}</Td>
                  <Td className="text-right tabular-nums">{formatCurrency(tb.creditTotal, currency)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          </TableWrap>
        </Card>

        <Card className="flex items-start gap-2 p-4 text-[11.5px] muted">
          <Banknote className="mt-0.5 size-4 shrink-0" />
          <p>Money is stored as exact decimal strings and computed with integer minor units, so no rounding drift can enter the ledger. Account 5100 is refunds, 6000 operating expenses, 6100 payroll.</p>
        </Card>
        <PageHeader title="" description="" className="hidden" />
      </PageBody>
    </>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className={bold ? "font-medium" : "muted"}>{label}</dt>
      <dd className={`tabular-nums ${bold ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
