import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { attendance, employees, leaveRequests, payrollRuns, sales, shifts } from "@/server/db/schema";
import type { DbLike } from "@/server/db";
import { add, money, multiply, percentOf, sub, sum } from "@/server/lib/money";

export async function listEmployees(db: DbLike, tenantId: string) {
  return db.select().from(employees).where(eq(employees.tenantId, tenantId)).orderBy(employees.name);
}

export async function createEmployee(
  db: DbLike,
  tenantId: string,
  input: { name: string; email?: string | null; phone?: string | null; position?: string; department?: string | null; salary?: string; commissionRate?: string; branchId?: string | null },
) {
  const [row] = await db
    .insert(employees)
    .values({
      tenantId,
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      position: input.position ?? "Staff",
      department: input.department ?? null,
      salary: money(input.salary ?? "0"),
      commissionRate: input.commissionRate ?? "0",
      branchId: input.branchId ?? null,
    })
    .returning();
  return row!;
}

export async function clockIn(db: DbLike, tenantId: string, employeeId: string, branchId?: string | null) {
  const [open] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.tenantId, tenantId), eq(attendance.employeeId, employeeId), isNull(attendance.clockOut)))
    .limit(1);
  if (open) return { alreadyOpen: true, attendance: open };
  const [row] = await db.insert(attendance).values({ tenantId, employeeId, branchId: branchId ?? null }).returning();
  return { alreadyOpen: false, attendance: row! };
}

export async function clockOut(db: DbLike, tenantId: string, employeeId: string) {
  const [open] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.tenantId, tenantId), eq(attendance.employeeId, employeeId), isNull(attendance.clockOut)))
    .limit(1);
  if (!open) throw new Error("No open shift for this employee");
  const now = new Date();
  const minutes = Math.round((now.getTime() - open.clockIn.getTime()) / 60000);
  const [row] = await db
    .update(attendance)
    .set({ clockOut: now, minutesWorked: minutes })
    .where(eq(attendance.id, open.id))
    .returning();
  return row!;
}

export async function scheduleShift(db: DbLike, tenantId: string, input: { employeeId: string; startsAt: Date; endsAt: Date; branchId?: string | null; role?: string }) {
  const [row] = await db
    .insert(shifts)
    .values({ tenantId, employeeId: input.employeeId, startsAt: input.startsAt, endsAt: input.endsAt, branchId: input.branchId ?? null, role: input.role ?? null })
    .returning();
  return row!;
}

export async function employeePerformance(db: DbLike, tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select({
      employeeId: sales.createdBy,
      name: sql<string>`coalesce(max(${employees.name}), 'Unknown')`,
      salesCount: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${sales.total}), 0)::text`,
    })
    .from(sales)
    .leftJoin(employees, eq(employees.userId, sales.createdBy))
    .where(and(eq(sales.tenantId, tenantId), gte(sales.createdAt, since)))
    .groupBy(sales.createdBy)
    .orderBy(desc(sql`sum(${sales.total})`));
  return rows.map((r) => ({ ...r, revenue: money(r.revenue) }));
}

/**
 * Payroll: base salary + commission on attributed sales − statutory deductions.
 * Money math is decimal-safe; the run is stored with its full line breakdown.
 */
export async function runPayroll(
  db: DbLike,
  tenantId: string,
  input: { periodLabel: string; days?: number; deductionRate?: number; createdBy: string },
) {
  const rows = await listEmployees(db, tenantId);
  const performance = await employeePerformance(db, tenantId, input.days ?? 30);
  const revenueByEmployee = new Map(performance.map((p) => [p.employeeId, p.revenue]));
  const deductionRate = input.deductionRate ?? 7.5;

  const lines = rows
    .filter((e) => e.status === "active")
    .map((e) => {
      const attributed = revenueByEmployee.get(e.userId ?? "") ?? "0";
      const commission = percentOf(attributed, e.commissionRate);
      const gross = add(e.salary, commission);
      const deductions = percentOf(gross, String(deductionRate));
      return {
        employeeId: e.id,
        name: e.name,
        base: money(e.salary),
        commission: money(commission),
        deductions: money(deductions),
        net: money(sub(gross, deductions)),
        gross,
      };
    });

  const grossTotal = sum(lines.map((l) => l.gross));
  const deductionsTotal = sum(lines.map((l) => l.deductions));
  const netTotal = sum(lines.map((l) => l.net));
  const [run] = await db
    .insert(payrollRuns)
    .values({
      tenantId,
      periodLabel: input.periodLabel,
      grossTotal,
      deductionsTotal,
      netTotal,
      lines: lines.map(({ gross: _gross, ...rest }) => rest),
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning();
  return { run: run!, lines };
}

export async function approvePayroll(db: DbLike, tenantId: string, runId: string) {
  const [row] = await db
    .update(payrollRuns)
    .set({ status: "approved" })
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.tenantId, tenantId)))
    .returning();
  return row;
}

export async function attendanceSummary(db: DbLike, tenantId: string, days = 7) {
  const since = new Date(Date.now() - days * 86400000);
  return db
    .select({
      employeeId: attendance.employeeId,
      name: employees.name,
      sessions: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${attendance.minutesWorked}), 0)::int`,
    })
    .from(attendance)
    .leftJoin(employees, eq(employees.id, attendance.employeeId))
    .where(and(eq(attendance.tenantId, tenantId), gte(attendance.clockIn, since)))
    .groupBy(attendance.employeeId, employees.name);
}

export async function requestLeave(db: DbLike, tenantId: string, input: { employeeId: string; startsAt: Date; endsAt: Date; reason?: string }) {
  const [row] = await db.insert(leaveRequests).values({ tenantId, employeeId: input.employeeId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason ?? null }).returning();
  return row!;
}

export async function decideLeave(db: DbLike, tenantId: string, id: string, decision: "approved" | "rejected", decidedBy: string) {
  const [row] = await db
    .update(leaveRequests)
    .set({ status: decision, decidedBy })
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenantId)))
    .returning();
  return row;
}

export { multiply };
