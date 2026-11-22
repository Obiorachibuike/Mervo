"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { businesses, memberships, roles, storefronts, tenants, users } from "@/server/db/schema";
import { branchSchema, zJson, ValidationError, emailSchema } from "@/server/lib/validation";
import { actionCtx, failure } from "./ctx";
import { createBranch, inviteMember } from "@/server/services/tenants";
import { assertWithinLimit, cancelSubscription, changePlan, resumeSubscription } from "@/server/services/subscriptions";
import { encryptSecret, generateTotpSecret, otpAuthUrl, verifyTotp } from "@/server/lib/crypto";
import { revalidatePath as revalidate } from "next/cache";

export async function updateBusinessAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2) throw new ValidationError("Business name is too short");
    const taxRate = Number(formData.get("taxRate") ?? 0);
    if (taxRate < 0 || taxRate > 100) throw new ValidationError("Tax rate must be between 0 and 100");
    await ctx.db
      .update(businesses)
      .set({
        name,
        legalName: String(formData.get("legalName") ?? "") || null,
        industry: String(formData.get("industry") ?? "retail"),
        email: String(formData.get("email") ?? "") || null,
        phone: String(formData.get("phone") ?? "") || null,
        address: String(formData.get("address") ?? "") || null,
        city: String(formData.get("city") ?? "") || null,
        currency: String(formData.get("currency") ?? "NGN"),
        taxRate: String(taxRate),
        taxInclusive: formData.get("taxInclusive") === "on",
        receiptFooter: String(formData.get("receiptFooter") ?? "") || null,
        updatedAt: new Date(),
      })
      .where(eq(businesses.tenantId, ctx.tenantId));
    await ctx.db.update(tenants).set({ name, currency: String(formData.get("currency") ?? "NGN"), updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
    await ctx.audit({ action: "business.update", entity: "business", entityId: ctx.tenantId, metadata: { name } });
    revalidatePath("/settings");
    return { ok: true, message: "Business profile saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function createBranchAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("branches.manage");
    await assertWithinLimit(ctx.db, ctx.tenantId, "branches");
    const parsed = zJson(branchSchema, Object.fromEntries(formData));
    const row = await createBranch(ctx.db, ctx.tenantId, parsed);
    await ctx.audit({ action: "branch.create", entity: "branch", entityId: row.id, metadata: { name: row.name } });
    revalidatePath("/settings/branches");
    revalidatePath("/dashboard");
    return { ok: true, message: `${row.name} created` };
  } catch (error) {
    return failure(error);
  }
}

export async function inviteMemberAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx(["employees.manage", "settings.manage"]);
    await assertWithinLimit(ctx.db, ctx.tenantId, "users");
    const email = emailSchema.safeParse(formData.get("email"));
    if (!email.success) throw new ValidationError("Enter a valid email address");
    const name = String(formData.get("name") ?? "").trim();
    const roleKey = String(formData.get("roleKey") ?? "cashier");
    if (name.length < 2) throw new ValidationError("Enter the person's name");
    const result = await inviteMember(ctx.db, { tenantId: ctx.tenantId, email: email.data, name, roleKey, branchId: String(formData.get("branchId") ?? "") || null });
    await ctx.audit({ action: "team.invite", entity: "membership", entityId: result.membershipId ?? undefined, metadata: { email: email.data, roleKey } });
    revalidatePath("/settings/team");
    return { ok: true, message: `${name} invited as ${roleKey.replace(/_/g, " ")}` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateMemberRoleAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const membershipId = String(formData.get("membershipId"));
    const roleKey = String(formData.get("roleKey"));
    const [role] = await ctx.db.select().from(roles).where(and(eq(roles.key, roleKey), eq(roles.tenantId, ctx.tenantId))).limit(1);
    const [roleGlobal] = role ? [role] : await ctx.db.select().from(roles).where(and(eq(roles.key, roleKey), eq(roles.tenantId, ctx.tenantId))).limit(1);
    if (!roleGlobal) throw new ValidationError("Role not found");
    await ctx.db.update(memberships).set({ roleId: roleGlobal.id, updatedAt: new Date() }).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId)));
    await ctx.audit({ action: "team.role_change", entity: "membership", entityId: membershipId, severity: "warning", metadata: { roleKey } });
    revalidatePath("/settings/team");
    return { ok: true, message: "Role updated" };
  } catch (error) {
    return failure(error);
  }
}

export async function toggleMemberStatusAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const membershipId = String(formData.get("membershipId"));
    const status = String(formData.get("status")) === "active" ? "disabled" : "active";
    const [row] = await ctx.db
      .update(memberships)
      .set({ status: status as "active" | "disabled", updatedAt: new Date() })
      .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId)))
      .returning({ userId: memberships.userId });
    if (row && status === "disabled") {
      const { revokeUserSessions } = await import("@/server/auth/session-core");
      await revokeUserSessions(row.userId, ctx.userId, ctx.db);
    }
    await ctx.audit({ action: "team.status_change", entity: "membership", entityId: membershipId, severity: "warning", metadata: { status } });
    revalidatePath("/settings/team");
    return { ok: true, message: `Member ${status}` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateStorefrontAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (slug.length < 3) throw new ValidationError("Storefront handle must be at least 3 characters");
    const [conflict] = await ctx.db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.slug, slug)).limit(1);
    const [current] = await ctx.db.select().from(storefronts).where(eq(storefronts.tenantId, ctx.tenantId)).limit(1);
    if (conflict && conflict.id !== current?.id) throw new ValidationError("That storefront handle is already taken");
    await ctx.db
      .update(storefronts)
      .set({
        slug,
        headline: String(formData.get("headline") ?? "") || null,
        about: String(formData.get("about") ?? "") || null,
        deliveryFee: String(formData.get("deliveryFee") ?? "0"),
        isPublished: formData.get("isPublished") === "on",
        updatedAt: new Date(),
      })
      .where(eq(storefronts.tenantId, ctx.tenantId));
    await ctx.audit({ action: "storefront.update", entity: "storefront", entityId: current?.id, metadata: { slug } });
    revalidatePath("/settings/storefront");
    return { ok: true, message: "Storefront saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function changePlanAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("billing.manage");
    const planCode = String(formData.get("planCode"));
    const interval = String(formData.get("interval") ?? "monthly") as "monthly" | "yearly";
    await changePlan(ctx.db, ctx.tenantId, planCode, interval);
    await ctx.audit({ action: "billing.plan_change", entity: "subscription", entityId: ctx.tenantId, severity: "warning", metadata: { planCode, interval } });
    revalidatePath("/settings/billing");
    return { ok: true, message: `Plan changed to ${planCode}` };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelPlanAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("billing.manage");
    await cancelSubscription(ctx.db, ctx.tenantId, false);
    await ctx.audit({ action: "billing.cancel", entity: "subscription", entityId: ctx.tenantId, severity: "critical" });
    revalidatePath("/settings/billing");
    return { ok: true, message: "Subscription will cancel at the end of the period" };
  } catch (error) {
    return failure(error);
  }
}

export async function resumePlanAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("billing.manage");
    await resumeSubscription(ctx.db, ctx.tenantId);
    revalidatePath("/settings/billing");
    return { ok: true, message: "Subscription resumed" };
  } catch (error) {
    return failure(error);
  }
}

export async function startMfaAction(): Promise<{ ok: boolean; message?: string; secret?: string; otpUrl?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const secret = generateTotpSecret();
    await ctx.db.update(users).set({ mfaSecret: encryptSecret(secret) }).where(eq(users.id, ctx.userId));
    return { ok: true, secret, otpUrl: otpAuthUrl(secret, ctx.auth.user.email) };
  } catch (error) {
    return failure(error) as { ok: boolean; message?: string };
  }
}

export async function confirmMfaAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const code = String(formData.get("code") ?? "");
    const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId));
    const { decryptSecret } = await import("@/server/lib/crypto");
    const secret = decryptSecret(user?.mfaSecret);
    if (!secret || !verifyTotp(secret, code)) throw new ValidationError("That code is not valid — check your authenticator app");
    await ctx.db.update(users).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(users.id, ctx.userId));
    await ctx.audit({ action: "auth.mfa_enabled", severity: "warning" });
    revalidate("/settings/security");
    return { ok: true, message: "Two-factor authentication enabled" };
  } catch (error) {
    return failure(error);
  }
}

export async function disableMfaAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    await ctx.db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.id, ctx.userId));
    await ctx.audit({ action: "auth.mfa_disabled", severity: "critical" });
    revalidate("/settings/security");
    return { ok: true, message: "Two-factor authentication disabled" };
  } catch (error) {
    return failure(error);
  }
}

export async function signOutOtherSessionsAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await actionCtx("settings.manage");
    const { revokeUserSessions } = await import("@/server/auth/session-core");
    await revokeUserSessions(ctx.userId, ctx.auth.sessionId, ctx.db);
    await ctx.audit({ action: "auth.sessions_revoked", severity: "warning" });
    return { ok: true, message: "All other sessions signed out" };
  } catch (error) {
    return failure(error);
  }
}
