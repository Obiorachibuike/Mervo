import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { accounts, expenses, journalEntries, journalLines, sales, suppliers } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { add, eq as moneyEq, fromMinor, isZero, money, sub, sum, toMinor } from "@/server/lib/money";

export const DEFAULT_ACCOUNTS = [
  { code: "1000", name: "Cash on Hand", type: "asset" as const },
  { code: "1010", name: "Bank Account", type: "asset" as const },
  { code: "1100", name: "Accounts Receivable", type: "asset" as const },
  { code: "1200", name: "Inventory", type: "asset" as const },
  { code: "1500", name: "Fixed Assets", type: "asset" as const },
  { code: "2000", name: "Accounts Payable", type: "liability" as const },
  { code: "2100", name: "Tax Payable", type: "liability" as const },
  { code: "2200", name: "Customer Deposits", type: "liability" as const },
  { code: "3000", name: "Owner's Equity", type: "equity" as const },
  { code: "3100", name: "Retained Earnings", type: "equity" as const },
  { code: "4000", name: "Sales Revenue", type: "revenue" as const },
  { code: "4100", name: "Service Revenue", type: "revenue" as const },
  { code: "4200", name: "Other Income", type: "revenue" as const },
  { code: "5000", name: "Cost of Goods Sold", type: "expense" as const },
  { code: "5100", name: "Refunds & Allowances", type: "expense" as const },
  { code: "6000", name: "Operating Expenses", type: "expense" as const },
  { code: "6100", name: "Payroll Expense", type: "expense" as const },
  { code: "6200", name: "Rent & Utilities", type: "expense" as const },
] as const;

export const ACCOUNT_CODES = {
  cash: "1000",
  bank: "1010",
  receivable: "1100",
  inventory: "1200",
  payable: "2000",
  tax: "2100",
  equity: "3000",
  revenue: "4000",
  cogs: "5000",
  refunds: "5100",
  opex: "6000",
  payroll: "6100",
} as const;

export async function ensureChartOfAccounts(db: DbLike, tenantId: string): Promise<void> {
  const existing = await db.select({ code: accounts.code }).from(accounts).where(eq(accounts.tenantId, tenantId));
  const have = new Set(existing.map((r) => r.code));
  const missing = DEFAULT_ACCOUNTS.filter((a) => !have.has(a.code));
  if (missing.length === 0) return;
  await db.insert(accounts).values(
    missing.map((a) => ({ tenantId, code: a.code, name: a.name, type: a.type, isSystem: true })),
  );
}

async function accountIds(db: DbLike, tenantId: string): Promise<Record<string, string>> {
  const rows = await db.select({ id: accounts.id, code: accounts.code }).from(accounts).where(eq(accounts.tenantId, tenantId));
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

export type JournalLineInput = { code: string; debit?: string; credit?: string; description?: string };

export class UnbalancedJournalError extends Error {
  constructor(debits: string, credits: string) {
    super(`Journal entry is not balanced: debits ${debits} vs credits ${credits}`);
    this.name = "UnbalancedJournalError";
  }
}

/**
 * Posts a double-entry journal. Refuses to write an unbalanced entry, which is
 * what keeps the ledger trustworthy regardless of what called it.
 */
export async function postJournal(
  db: DbLike,
  input: {
    tenantId: string;
    branchId?: string | null;
    memo: string;
    referenceType?: string;
    referenceId?: string;
    currency?: string;
    createdBy?: string | null;
    date?: Date;
    lines: JournalLineInput[];
    isClosing?: boolean;
  },
): Promise<{ entryId: string; entryNumber: string } | null> {
  const lines = input.lines.filter((l) => !isZero(l.debit ?? "0") || !isZero(l.credit ?? "0"));
  if (lines.length === 0) return null;

  const debitTotal = sum(lines.map((l) => l.debit ?? "0"));
  const creditTotal = sum(lines.map((l) => l.credit ?? "0"));
  if (!moneyEq(debitTotal, creditTotal)) throw new UnbalancedJournalError(debitTotal, creditTotal);

  await ensureChartOfAccounts(db, input.tenantId);
  const ids = await accountIds(db, input.tenantId);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, input.tenantId));
  const entryNumber = `JE-${String(count + 1).padStart(6, "0")}`;

  const [entry] = await db
    .insert(journalEntries)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId ?? null,
      entryNumber,
      memo: input.memo,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      currency: input.currency ?? "NGN",
      createdBy: input.createdBy ?? null,
      date: input.date ?? new Date(),
      isClosing: input.isClosing ?? false,
    })
    .returning({ id: journalEntries.id });

  await db.insert(journalLines).values(
    lines.map((l) => ({
      tenantId: input.tenantId,
      entryId: entry!.id,
      accountId: ids[l.code]!,
      debit: money(l.debit ?? "0"),
      credit: money(l.credit ?? "0"),
      description: l.description ?? input.memo,
    })),
  );

  return { entryId: entry!.id, entryNumber };
}

/** Journal for a completed sale: cash/AR in, revenue + tax out, COGS/inventory. */
export function saleJournalLines(input: {
  total: string;
  taxTotal: string;
  netRevenue: string;
  costTotal: string;
  paidTotal: string;
  method: string;
}): JournalLineInput[] {
  const total = money(input.total);
  // Cash received can exceed the sale total (change given); the ledger records
  // only the value actually earned, so clamp the debit at the total.
  const paid = toMinor(input.paidTotal) > toMinor(total) ? total : money(input.paidTotal);
  const credit = sub(total, paid);
  const cashCode = input.method === "transfer" || input.method === "card" || input.method.includes("paystack") || input.method.includes("stripe") || input.method.includes("flutterwave") ? ACCOUNT_CODES.bank : ACCOUNT_CODES.cash;
  const lines: JournalLineInput[] = [];
  if (!isZero(paid)) lines.push({ code: cashCode, debit: paid, description: "Payment received" });
  if (toMinor(credit) > 0n) lines.push({ code: ACCOUNT_CODES.receivable, debit: credit, description: "Credit sale" });
  lines.push({ code: ACCOUNT_CODES.revenue, credit: input.netRevenue, description: "Sales revenue" });
  if (!isZero(input.taxTotal)) lines.push({ code: ACCOUNT_CODES.tax, credit: input.taxTotal, description: "Tax collected" });
  if (!isZero(input.costTotal)) {
    lines.push({ code: ACCOUNT_CODES.cogs, debit: input.costTotal, description: "Cost of goods sold" });
    lines.push({ code: ACCOUNT_CODES.inventory, credit: input.costTotal, description: "Inventory relieved" });
  }
  return lines;
}

export function refundJournalLines(input: { amount: string; taxPortion: string; costPortion: string; method: string }): JournalLineInput[] {
  const cashCode = input.method === "cash" ? ACCOUNT_CODES.cash : ACCOUNT_CODES.bank;
  const lines: JournalLineInput[] = [
    { code: ACCOUNT_CODES.refunds, debit: input.amount, description: "Refund issued" },
    { code: cashCode, credit: input.amount, description: "Refund payout" },
  ];
  if (!isZero(input.costPortion)) {
    lines.push({ code: ACCOUNT_CODES.inventory, debit: input.costPortion, description: "Stock returned" });
    lines.push({ code: ACCOUNT_CODES.cogs, credit: input.costPortion, description: "COGS reversed" });
  }
  return lines;
}

export function expenseJournalLines(input: { amount: string; method: string; paid?: boolean }): JournalLineInput[] {
  const creditCode = input.paid === false ? ACCOUNT_CODES.payable : input.method === "cash" ? ACCOUNT_CODES.cash : ACCOUNT_CODES.bank;
  return [
    { code: ACCOUNT_CODES.opex, debit: input.amount, description: "Operating expense" },
    { code: creditCode, credit: input.amount, description: input.paid === false ? "Payable recorded" : "Expense paid" },
  ];
}

/* ─────────────────────────────── reporting ──────────────────────────────── */

export type PeriodRange = { from: Date; to: Date };

export async function accountBalances(db: DbLike, tenantId: string, range?: PeriodRange) {
  const conditions = [eq(journalLines.tenantId, tenantId)];
  if (range) conditions.push(gte(journalEntries.date, range.from), lte(journalEntries.date, range.to));
  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::text`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::text`,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conditions))
    .groupBy(accounts.code, accounts.name, accounts.type)
    .orderBy(asc(accounts.code));
  return rows.map((r) => {
    const debit = money(r.debit);
    const credit = money(r.credit);
    const signed = r.type === "asset" || r.type === "expense" ? sub(debit, credit) : sub(credit, debit);
    return { ...r, debit, credit, balance: signed };
  });
}

export async function trialBalance(db: DbLike, tenantId: string, range?: PeriodRange) {
  const rows = await accountBalances(db, tenantId, range);
  const debitTotal = sum(rows.map((r) => r.debit));
  const creditTotal = sum(rows.map((r) => r.credit));
  return { rows, debitTotal, creditTotal, balanced: moneyEq(debitTotal, creditTotal) };
}

export type ProfitAndLoss = {
  revenue: string;
  costOfGoods: string;
  grossProfit: string;
  refunds: string;
  expenses: string;
  netProfit: string;
  taxCollected: string;
  margins: { gross: number; net: number };
  lines: { code: string; name: string; amount: string; type: string }[];
  range: PeriodRange;
};

/**
 * Deterministic profit & loss. Revenue is never conflated with gross or net
 * profit; every figure comes from the double-entry ledger.
 */
export async function profitAndLoss(db: DbLike, tenantId: string, range: PeriodRange): Promise<ProfitAndLoss> {
  const rows = await accountBalances(db, tenantId, range);
  const revenueRows = rows.filter((r) => r.type === "revenue");
  const expenseRows = rows.filter((r) => r.type === "expense");
  const revenue = sum(revenueRows.filter((r) => r.code !== "5100").map((r) => r.balance));
  const cogs = money(rows.find((r) => r.code === ACCOUNT_CODES.cogs)?.balance ?? "0");
  const refunds = money(rows.find((r) => r.code === ACCOUNT_CODES.refunds)?.balance ?? "0");
  const grossProfit = sub(sub(revenue, refunds), cogs);
  const expenses = sum(expenseRows.filter((r) => r.code !== ACCOUNT_CODES.cogs && r.code !== ACCOUNT_CODES.refunds).map((r) => r.balance));
  const netProfit = sub(grossProfit, expenses);
  const taxCollected = money(rows.find((r) => r.code === ACCOUNT_CODES.tax)?.balance ?? "0");
  const revenueNum = Number(revenue);
  return {
    revenue,
    costOfGoods: cogs,
    grossProfit,
    refunds,
    expenses,
    netProfit,
    taxCollected,
    margins: {
      gross: revenueNum ? Math.round((Number(grossProfit) / revenueNum) * 1000) / 10 : 0,
      net: revenueNum ? Math.round((Number(netProfit) / revenueNum) * 1000) / 10 : 0,
    },
    lines: rows.map((r) => ({ code: r.code, name: r.name, amount: r.balance, type: r.type })),
    range,
  };
}

export async function balanceSheet(db: DbLike, tenantId: string, asOf = new Date()) {
  const rows = await accountBalances(db, tenantId, { from: new Date(0), to: asOf });
  const assets = rows.filter((r) => r.type === "asset");
  const liabilities = rows.filter((r) => r.type === "liability");
  const equity = rows.filter((r) => r.type === "equity");
  const revenue = sum(rows.filter((r) => r.type === "revenue").map((r) => r.balance));
  const expenseTotal = sum(rows.filter((r) => r.type === "expense").map((r) => r.balance));
  const retained = sub(revenue, expenseTotal);
  const totalAssets = sum(assets.map((r) => r.balance));
  const totalLiabilities = sum(liabilities.map((r) => r.balance));
  const equityTotal = add(sum(equity.map((r) => r.balance)), retained);
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    retainedEarnings: retained,
    totalEquity: equityTotal,
    balanced: moneyEq(totalAssets, add(totalLiabilities, equityTotal)),
  };
}

export async function cashFlow(db: DbLike, tenantId: string, range: PeriodRange) {
  const rows = await accountBalances(db, tenantId, range);
  const cashIn = money(rows.find((r) => r.code === ACCOUNT_CODES.cash)?.debit ?? "0");
  const cashOut = money(rows.find((r) => r.code === ACCOUNT_CODES.cash)?.credit ?? "0");
  const bankIn = money(rows.find((r) => r.code === ACCOUNT_CODES.bank)?.debit ?? "0");
  const bankOut = money(rows.find((r) => r.code === ACCOUNT_CODES.bank)?.credit ?? "0");
  return {
    cashIn,
    cashOut,
    bankIn,
    bankOut,
    netCash: sub(cashIn, cashOut),
    netBank: sub(bankIn, bankOut),
    net: add(sub(cashIn, cashOut), sub(bankIn, bankOut)),
  };
}

export async function receivables(db: DbLike, tenantId: string) {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${sales.balanceDue}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), sql`${sales.balanceDue} > 0`));
  return { total: money(rows[0]?.total ?? "0"), count: rows[0]?.count ?? 0 };
}

export async function payables(db: DbLike, tenantId: string) {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${suppliers.balanceOwed}), 0)::text` })
    .from(suppliers)
    .where(eq(suppliers.tenantId, tenantId));
  return { total: money(rows[0]?.total ?? "0") };
}

export async function recordExpense(
  db: DbLike,
  input: { tenantId: string; userId: string; description: string; amount: string; method: string; branchId?: string | null; supplierId?: string | null; date?: Date; categoryId?: string | null },
) {
  const [row] = await db
    .insert(expenses)
    .values({
      tenantId: input.tenantId,
      description: input.description,
      amount: money(input.amount),
      method: input.method,
      branchId: input.branchId ?? null,
      supplierId: input.supplierId ?? null,
      categoryId: input.categoryId ?? null,
      date: input.date ?? new Date(),
      createdBy: input.userId,
      status: "paid",
    })
    .returning({ id: expenses.id });

  await postJournal(db, {
    tenantId: input.tenantId,
    branchId: input.branchId ?? null,
    memo: `Expense — ${input.description}`,
    referenceType: "expense",
    referenceId: row!.id,
    createdBy: input.userId,
    date: input.date ?? new Date(),
    lines: expenseJournalLines({ amount: money(input.amount), method: input.method }),
  });
  return row!;
}

export const journalSpan = (days: number): PeriodRange => {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  return { from, to };
};

export { fromMinor };
