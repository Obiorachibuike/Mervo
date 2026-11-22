import type { Metadata } from "next";
import { and, asc, desc, eq } from "drizzle-orm";
import { CalendarClock, Clock, Users, Wallet } from "lucide-react";
import { getDb } from "@/server/db";
import { attendance, branches, businesses, employees, leaveRequests, payrollRuns, shifts } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, SectionTitle } from "@/components/ui/page";
import { PagePermission } from "@/components/shell/permission-gate";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { approvePayrollAction, clockAction, createEmployeeAction, requestLeaveAction, runPayrollAction, scheduleShiftAction } from "@/server/actions/ops";
import { attendanceSummary, employeePerformance } from "@/server/services/employees";
import { formatCurrency, formatNumber, dateTime, shortDate, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Employees" };
export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";

  const [team, branchRows, perf, attendanceRows, runs, shiftRows, leaveRows, openSessions] = await Promise.all([
    db.select().from(employees).where(eq(employees.tenantId, auth.tenantId)).orderBy(asc(employees.name)),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId)),
    employeePerformance(db, auth.tenantId, 30).catch(() => []),
    attendanceSummary(db, auth.tenantId, 7),
    db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, auth.tenantId)).orderBy(desc(payrollRuns.createdAt)).limit(6),
    db
      .select({ shift: shifts, employeeName: employees.name })
      .from(shifts)
      .leftJoin(employees, eq(employees.id, shifts.employeeId))
      .where(eq(shifts.tenantId, auth.tenantId))
      .orderBy(desc(shifts.startsAt))
      .limit(10),
    db
      .select({ leave: leaveRequests, employeeName: employees.name })
      .from(leaveRequests)
      .leftJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .where(eq(leaveRequests.tenantId, auth.tenantId))
      .orderBy(desc(leaveRequests.startsAt))
      .limit(8),
    db.select({ employeeId: attendance.employeeId, clockIn: attendance.clockIn }).from(attendance).where(and(eq(attendance.tenantId, auth.tenantId))),
  ]);

  const openMap = new Map(openSessions.filter((a) => !a.clockIn ? false : true).map((a) => [a.employeeId, a.clockIn]));
  const payrollTotal = team.reduce((s, e) => s + Number(e.salary), 0);
  const perfMap = new Map(perf.map((p) => [p.employeeId, p]));
  const attendanceMap = new Map(attendanceRows.map((a) => [a.employeeId, a]));

  return (
    <>
      <Topbar title="Employees" subtitle="Team records, shifts, attendance and payroll" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Team" value={formatNumber(team.length)} hint={`${team.filter((e) => e.status === "active").length} active`} icon={<Users className="size-4" />} />
          <StatCard label="Monthly payroll" value={formatCurrency(payrollTotal.toFixed(2), currency)} hint="Base salaries before deductions" icon={<Wallet className="size-4" />} />
          <StatCard label="Clocked in now" value={formatNumber(openMap.size)} hint="Open attendance sessions" icon={<Clock className="size-4" />} />
          <StatCard label="Shifts scheduled" value={formatNumber(shiftRows.length)} hint={`${leaveRows.filter((l) => l.leave.status === "pending").length} leave requests pending`} icon={<CalendarClock className="size-4" />} />
        </div>

        <PagePermission permission="employees.manage">
          <Disclosure title="Add a team member" description="Employee records drive payroll, shifts and performance." cta="New employee" defaultOpen={team.length === 0}>
            <ActionForm action={createEmployeeAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Full name *"><Input name="name" required /></Field>
              <Field label="Position"><Input name="position" defaultValue="Sales assistant" /></Field>
              <Field label="Department"><Input name="department" placeholder="Retail" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Phone"><Input name="phone" /></Field>
              <Field label="Branch">
                <Select name="branchId" defaultValue={branchRows[0]?.id ?? ""}>
                  <option value="">Workspace-wide</option>
                  {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Monthly salary"><Input name="salary" type="number" step="0.01" min="0" defaultValue="0" /></Field>
              <Field label="Commission %"><Input name="commissionRate" type="number" step="0.01" min="0" defaultValue="0" /></Field>
              <div className="flex items-end"><SubmitButton>Add employee</SubmitButton></div>
            </ActionForm>
          </Disclosure>
        </PagePermission>

        <TableWrap>
          <Table>
            <thead><tr><Th>Employee</Th><Th>Position</Th><Th>Branch</Th><Th className="text-right">Salary</Th><Th className="text-right">Sales (30d)</Th><Th className="text-right">7-day hours</Th><Th className="text-right">Attendance</Th></tr></thead>
            <tbody>
              {team.map((employee) => {
                const session = openMap.get(employee.id);
                const stat = perfMap.get(employee.id);
                const att = attendanceMap.get(employee.id);
                return (
                  <Tr key={employee.id}>
                    <Td>
                      <span className="text-[12.5px] font-medium">{employee.name}</span>
                      <p className="text-[10.5px] muted">{employee.email ?? employee.phone ?? "—"}</p>
                    </Td>
                    <Td className="text-[11.5px]">{employee.position}<p className="text-[10.5px] muted">{employee.department ?? ""}</p></Td>
                    <Td className="text-[11px] muted">{branchRows.find((b) => b.id === employee.branchId)?.name ?? "All"}</Td>
                    <Td className="text-right tabular-nums">{formatCurrency(employee.salary, currency)}</Td>
                    <Td className="text-right tabular-nums">{stat ? formatCurrency(stat.revenue ?? "0", currency) : "—"}</Td>
                    <Td className="text-right tabular-nums">{att ? (att.minutes / 60).toFixed(1) : "0.0"}</Td>
                    <Td className="text-right">
                      <ActionButton action={clockAction} payload={{ employeeId: employee.id, direction: session ? "out" : "in" }} variant={session ? "outline" : "secondary"}>
                        {session ? "Clock out" : "Clock in"}
                      </ActionButton>
                    </Td>
                  </Tr>
                );
              })}
              {team.length === 0 ? <Tr><Td colSpan={7} className="text-[12px] muted">No employees recorded yet.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>

        <div className="grid gap-4 lg:grid-cols-2">
          <Disclosure title="Schedule a shift" description="Plan coverage per branch and role." cta="New shift">
            <ActionForm action={scheduleShiftAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee">
                <Select name="employeeId" required>{team.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
              </Field>
              <Field label="Branch">
                <Select name="branchId" defaultValue={branchRows[0]?.id ?? ""}>{branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
              </Field>
              <Field label="Starts"><Input name="startsAt" type="datetime-local" required /></Field>
              <Field label="Ends"><Input name="endsAt" type="datetime-local" required /></Field>
              <Field label="Role"><Input name="role" placeholder="Floor" /></Field>
              <div className="flex items-end"><SubmitButton variant="outline">Schedule</SubmitButton></div>
            </ActionForm>
          </Disclosure>

          <Disclosure title="Request leave" description="Leave requests are tracked and approved by a manager." cta="New request">
            <ActionForm action={requestLeaveAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee">
                <Select name="employeeId" required>{team.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
              </Field>
              <Field label="Reason"><Input name="reason" placeholder="Annual leave" /></Field>
              <Field label="From"><Input name="startsAt" type="date" required /></Field>
              <Field label="To"><Input name="endsAt" type="date" required /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} /></Field>
              <div className="sm:col-span-2"><SubmitButton variant="outline">Submit request</SubmitButton></div>
            </ActionForm>
          </Disclosure>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-0">
            <div className="p-4"><SectionTitle hint={`${shiftRows.length} recent`}>Shifts &amp; leave</SectionTitle></div>
            <TableWrap>
              <Table>
                <thead><tr><Th>Employee</Th><Th>Type</Th><Th>When</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {shiftRows.slice(0, 5).map(({ shift, employeeName }) => (
                    <Tr key={shift.id}>
                      <Td className="text-[12px]">{employeeName}</Td>
                      <Td className="text-[11px] muted">Shift</Td>
                      <Td className="text-[11px] muted">{dateTime(shift.startsAt)} → {shortDate(shift.endsAt)}</Td>
                      <Td><Badge tone={shift.status === "completed" ? "success" : "neutral"}>{titleCase(shift.status)}</Badge></Td>
                    </Tr>
                  ))}
                  {leaveRows.map(({ leave, employeeName }) => (
                    <Tr key={leave.id}>
                      <Td className="text-[12px]">{employeeName}</Td>
                      <Td className="text-[11px] muted">Leave</Td>
                      <Td className="text-[11px] muted">{shortDate(leave.startsAt)} → {shortDate(leave.endsAt)}</Td>
                      <Td><Badge tone={leave.status === "approved" ? "success" : leave.status === "rejected" ? "danger" : "warning"}>{titleCase(leave.status)}</Badge></Td>
                    </Tr>
                  ))}
                  {shiftRows.length === 0 && leaveRows.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No shifts or leave recorded.</Td></Tr> : null}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <Card className="p-0">
            <div className="p-4">
              <PagePermission permission="employees.payroll">
                <ActionForm action={runPayrollAction} className="flex flex-wrap items-end gap-2">
                  <Field label="Payroll period"><Input name="periodLabel" defaultValue={new Date().toISOString().slice(0, 7)} placeholder="2026-11" /></Field>
                  <Field label="Deduction %"><Input name="deductionRate" type="number" step="0.01" min="0" max="100" defaultValue="7.5" className="w-24" /></Field>
                  <SubmitButton variant="secondary">Run payroll</SubmitButton>
                </ActionForm>
              </PagePermission>
            </div>
            <TableWrap>
              <Table>
                <thead><tr><Th>Period</Th><Th className="text-right">Gross</Th><Th className="text-right">Net</Th><Th>Status</Th><Th className="text-right">Action</Th></tr></thead>
                <tbody>
                  {runs.map((run) => (
                    <Tr key={run.id}>
                      <Td className="text-[12px]">{run.periodLabel}</Td>
                      <Td className="text-right tabular-nums">{formatCurrency(run.grossTotal, currency)}</Td>
                      <Td className="text-right tabular-nums font-medium">{formatCurrency(run.netTotal, currency)}</Td>
                      <Td><Badge tone={run.status === "paid" ? "success" : run.status === "approved" ? "info" : "warning"}>{titleCase(run.status)}</Badge></Td>
                      <Td className="text-right">
                        {run.status === "draft" ? (
                          <ActionButton action={approvePayrollAction} payload={{ runId: run.id }} confirm="Approve this payroll run and post it to the ledger?">
                            Approve
                          </ActionButton>
                        ) : <span className="text-[11px] muted">—</span>}
                      </Td>
                    </Tr>
                  ))}
                  {runs.length === 0 ? <Tr><Td colSpan={5} className="text-[12px] muted">No payroll runs yet.</Td></Tr> : null}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
