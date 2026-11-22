"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { automationRules, employees, kitchenOrders } from "@/server/db/schema";
import { actionCtx, failure } from "./ctx";
import { approvePayroll, clockIn, clockOut, createEmployee, requestLeave, runPayroll, scheduleShift } from "@/server/services/employees";
import { advanceKitchenOrder, createMenuItem, createReservation, setTableStatus } from "@/server/services/restaurant";
import { createRule, runRule, toggleRule, AUTOMATION_TEMPLATES } from "@/server/services/automation";
import { dismissInsight } from "@/server/ai/insights";
import { ValidationError } from "@/server/lib/validation";

export async function createEmployeeAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("employees.manage");
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2) throw new ValidationError("Enter the employee's name");
    const row = await createEmployee(ctx.db, ctx.tenantId, {
      name,
      email: String(formData.get("email") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      position: String(formData.get("position") ?? "Staff"),
      department: String(formData.get("department") ?? "") || null,
      salary: String(formData.get("salary") ?? "0"),
      commissionRate: String(formData.get("commissionRate") ?? "0"),
      branchId: String(formData.get("branchId") ?? "") || null,
    });
    await ctx.audit({ action: "employee.create", entity: "employee", entityId: row.id, metadata: { name, salary: row.salary } });
    revalidatePath("/employees");
    return { ok: true, message: `${name} added to the team` };
  } catch (error) {
    return failure(error);
  }
}

export async function clockAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("employees.view");
    const employeeId = String(formData.get("employeeId"));
    const direction = String(formData.get("direction"));
    const [employee] = await ctx.db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, ctx.tenantId))).limit(1);
    if (!employee) throw new ValidationError("Employee not found");
    if (direction === "out") {
      const result = await clockOut(ctx.db, ctx.tenantId, employeeId);
      await ctx.audit({ action: "attendance.clock_out", entity: "employee", entityId: employeeId, metadata: { minutes: result.minutesWorked } });
      revalidatePath("/employees");
      return { ok: true, message: `${employee.name} clocked out after ${Math.round((result.minutesWorked ?? 0) / 60)}h` };
    }
    const result = await clockIn(ctx.db, ctx.tenantId, employeeId, employee.branchId);
    await ctx.audit({ action: "attendance.clock_in", entity: "employee", entityId: employeeId });
    revalidatePath("/employees");
    return { ok: true, message: result.alreadyOpen ? `${employee.name} is already clocked in` : `${employee.name} clocked in` };
  } catch (error) {
    return failure(error);
  }
}

export async function scheduleShiftAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("employees.manage");
    const employeeId = String(formData.get("employeeId"));
    const startsAt = new Date(String(formData.get("startsAt")));
    const endsAt = new Date(String(formData.get("endsAt")));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new ValidationError("Choose valid shift times");
    if (endsAt <= startsAt) throw new ValidationError("Shift must end after it starts");
    await scheduleShift(ctx.db, ctx.tenantId, { employeeId, startsAt, endsAt, branchId: String(formData.get("branchId") ?? "") || null, role: String(formData.get("role") ?? "") || undefined });
    revalidatePath("/employees");
    return { ok: true, message: "Shift scheduled" };
  } catch (error) {
    return failure(error);
  }
}

export async function requestLeaveAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("employees.view");
    const employeeId = String(formData.get("employeeId"));
    await requestLeave(ctx.db, ctx.tenantId, {
      employeeId,
      startsAt: new Date(String(formData.get("startsAt"))),
      endsAt: new Date(String(formData.get("endsAt"))),
      reason: String(formData.get("reason") ?? "") || undefined,
    });
    revalidatePath("/employees");
    return { ok: true, message: "Leave request submitted" };
  } catch (error) {
    return failure(error);
  }
}

export async function runPayrollAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("employees.payroll");
    const label = String(formData.get("periodLabel") ?? new Date().toISOString().slice(0, 7));
    const { run } = await runPayroll(ctx.db, ctx.tenantId, { periodLabel: label, deductionRate: Number(formData.get("deductionRate") ?? 7.5), createdBy: ctx.userId });
    await ctx.audit({ action: "payroll.run", entity: "payroll_run", entityId: run.id, severity: "warning", metadata: { periodLabel: label, net: run.netTotal } });
    revalidatePath("/employees");
    return { ok: true, message: `Payroll drafted for ${label} — net ${run.netTotal}` };
  } catch (error) {
    return failure(error);
  }
}

export async function approvePayrollAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("employees.payroll");
    await approvePayroll(ctx.db, ctx.tenantId, String(formData.get("runId")));
    await ctx.audit({ action: "payroll.approve", entity: "payroll_run", entityId: String(formData.get("runId")), severity: "critical" });
    revalidatePath("/employees");
    return { ok: true, message: "Payroll approved" };
  } catch (error) {
    return failure(error);
  }
}

export async function setTableStatusAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("restaurant.manage");
    const tableId = String(formData.get("tableId"));
    const status = String(formData.get("status")) as "free" | "occupied" | "reserved" | "cleaning";
    await setTableStatus(ctx.db, ctx.tenantId, tableId, status);
    revalidatePath("/restaurant");
    return { ok: true, message: `Table marked ${status}` };
  } catch (error) {
    return failure(error);
  }
}

export async function advanceKitchenAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("restaurant.manage");
    const orderId = String(formData.get("orderId"));
    const status = String(formData.get("status")) as "preparing" | "ready" | "served" | "cancelled";
    await advanceKitchenOrder(ctx.db, ctx.tenantId, orderId, status);
    revalidatePath("/restaurant");
    return { ok: true, message: `Order moved to ${status}` };
  } catch (error) {
    return failure(error);
  }
}

export async function createReservationAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("restaurant.manage");
    const customerName = String(formData.get("customerName") ?? "").trim();
    if (customerName.length < 2) throw new ValidationError("Enter the guest's name");
    const reservedAt = new Date(String(formData.get("reservedAt")));
    if (Number.isNaN(reservedAt.getTime())) throw new ValidationError("Choose a valid date and time");
    await createReservation(ctx.db, ctx.tenantId, {
      branchId: String(formData.get("branchId")),
      tableId: String(formData.get("tableId") ?? "") || null,
      customerName,
      phone: String(formData.get("phone") ?? "") || null,
      partySize: Number(formData.get("partySize") ?? 2),
      reservedAt,
      notes: String(formData.get("notes") ?? "") || null,
    });
    revalidatePath("/restaurant");
    return { ok: true, message: `Reservation for ${customerName} saved` };
  } catch (error) {
    return failure(error);
  }
}

export async function createAutomationAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("automation.manage");
    const templateKey = String(formData.get("template") ?? "");
    const template = AUTOMATION_TEMPLATES.find((t) => t.key === templateKey);
    const name = String(formData.get("name") ?? "").trim() || template?.name || "New automation";
    await createRule(ctx.db, ctx.tenantId, {
      name,
      triggerType: (template?.triggerType ?? "schedule") as "schedule" | "event" | "threshold",
      triggerConfig: template?.triggerConfig ?? { cron: "daily", at: "08:00" },
      actionType: (template?.actionType ?? "notify") as "notify" | "email" | "report" | "restock_suggestion" | "create_po" | "webhook",
      actionConfig: template?.actionConfig ?? { channel: "dashboard", severity: "info" },
      requiresApproval: formData.get("requiresApproval") === "on",
      createdBy: ctx.userId,
    });
    await ctx.audit({ action: "automation.create", entity: "automation_rule", metadata: { name, template: templateKey } });
    revalidatePath("/automation");
    return { ok: true, message: `${name} created` };
  } catch (error) {
    return failure(error);
  }
}

export async function toggleAutomationAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("automation.manage");
    const id = String(formData.get("ruleId"));
    const isActive = formData.get("isActive") === "true";
    await toggleRule(ctx.db, ctx.tenantId, id, isActive);
    revalidatePath("/automation");
    return { ok: true, message: isActive ? "Automation enabled" : "Automation paused" };
  } catch (error) {
    return failure(error);
  }
}

export async function runAutomationNowAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("automation.manage");
    const id = String(formData.get("ruleId"));
    const [rule] = await ctx.db.select().from(automationRules).where(and(eq(automationRules.id, id), eq(automationRules.tenantId, ctx.tenantId))).limit(1);
    if (!rule) throw new ValidationError("Automation not found");
    const result = await runRule(ctx.db, rule);
    revalidatePath("/automation");
    return { ok: result.status === "success", message: result.output };
  } catch (error) {
    return failure(error);
  }
}

export async function dismissInsightAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("ai.assistant.use");
    await dismissInsight(ctx.db, ctx.tenantId, String(formData.get("insightId")));
    revalidatePath("/ai");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addMenuItemAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("restaurant.manage");
    const menuId = String(formData.get("menuId"));
    const productId = String(formData.get("productId"));
    const price = String(formData.get("price") ?? "0");
    if (Number(price) <= 0) throw new ValidationError("Enter a menu price");
    await createMenuItem(ctx.db, ctx.tenantId, { menuId, productId, price, station: String(formData.get("station") ?? "kitchen") });
    revalidatePath("/restaurant");
    return { ok: true, message: "Menu item added" };
  } catch (error) {
    return failure(error);
  }
}

export async function createKitchenTicketAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("restaurant.manage");
    const orderId = String(formData.get("orderId"));
    await ctx.db.update(kitchenOrders).set({ status: "preparing" }).where(and(eq(kitchenOrders.id, orderId), eq(kitchenOrders.tenantId, ctx.tenantId)));
    revalidatePath("/restaurant");
    return { ok: true, message: "Ticket started" };
  } catch (error) {
    return failure(error);
  }
}

export async function refreshInsightsAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("ai.assistant.use");
    const { refreshInsights } = await import("@/server/ai/insights");
    const result = await refreshInsights(ctx.db, ctx.tenantId);
    revalidatePath("/ai");
    revalidatePath("/dashboard");
    return { ok: true, message: `${result.generated} new insight(s) generated from your data` };
  } catch (error) {
    return failure(error);
  }
}
