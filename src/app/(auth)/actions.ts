"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { auditLogs, memberships, users, verificationTokens } from "@/server/db/schema";
import { hashPassword, randomToken, sha256, verifyPassword, verifyTotp } from "@/server/lib/crypto";
import { createSession, loadAuthContext, revokeSession, switchTenant, SESSION_COOKIE } from "@/server/auth/session-core";
import { loginSchema, registerSchema, zJson } from "@/server/lib/validation";
import { provisionBusiness } from "@/server/services/tenants";
import { rateLimit } from "@/server/lib/rate-limit";
import { setSessionCookie, clearSessionCookie, requestMeta } from "@/server/auth/session";

export type ActionState = { error?: string; success?: string; requiresMfa?: boolean; devLink?: string } | null;

async function clientKey(prefix: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${prefix}:${ip}`;
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    totp: formData.get("totp") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details" };

  const limit = await rateLimit({ bucket: "login", identifier: await clientKey("login"), limit: 10, windowSeconds: 300 });
  if (!limit.allowed) return { error: "Too many attempts. Please wait a few minutes and try again." };

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const meta = await requestMeta();

  const invalid = { error: "Incorrect email or password" };
  if (!user) {
    await new Promise((r) => setTimeout(r, 250));
    return invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: "This account is temporarily locked. Try again shortly or reset your password." };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    const attempts = user.failedLogins + 1;
    await db
      .update(users)
      .set({ failedLogins: attempts, lockedUntil: attempts >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null })
      .where(eq(users.id, user.id));
    return invalid;
  }

  if (user.mfaEnabled) {
    if (!parsed.data.totp) return { requiresMfa: true, error: "Enter the 6-digit code from your authenticator app." };
    const secret = (await import("@/server/lib/crypto")).decryptSecret(user.mfaSecret);
    if (!secret || !verifyTotp(secret, parsed.data.totp)) return { requiresMfa: true, error: "That code is not valid. Try the next one." };
  }

  const [membership] = await db.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.status, "active"))).limit(1);
  const session = await createSession(
    user.id,
    { tenantId: membership?.tenantId ?? null, ip: meta.ip, userAgent: meta.userAgent, mfaVerified: user.mfaEnabled },
    db,
  );
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await setSessionCookie(session.token, session.expiresAt);
  await db.insert(auditLogs).values({
    tenantId: membership?.tenantId ?? null,
    actorId: user.id,
    actorEmail: user.email,
    action: "auth.login",
    severity: "info",
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { mfa: user.mfaEnabled },
  });

  redirect(user.isSuperAdmin && !membership ? "/admin" : membership ? "/dashboard" : "/onboarding");
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    businessName: formData.get("businessName"),
    industry: formData.get("industry") ?? "retail",
    currency: formData.get("currency") ?? "NGN",
    country: formData.get("country") ?? "NG",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details" };

  const limit = await rateLimit({ bucket: "register", identifier: await clientKey("register"), limit: 5, windowSeconds: 3600 });
  if (!limit.allowed) return { error: "Too many sign-ups from this network. Please try again later." };

  const db = await getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (existing) return { error: "An account with that email already exists. Sign in instead." };

  const [user] = await db
    .insert(users)
    .values({
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    })
    .returning({ id: users.id });

  try {
    await provisionBusiness(db, {
      ownerUserId: user!.id,
      businessName: parsed.data.businessName,
      industry: parsed.data.industry,
      currency: parsed.data.currency,
      country: parsed.data.country,
      planCode: "free",
      withRestaurant: parsed.data.industry === "restaurant",
      seedCatalogue: true,
    });
  } catch (error) {
    await db.delete(users).where(eq(users.id, user!.id));
    console.error("provisioning failed", error);
    return { error: "We could not create your workspace. Please try again." };
  }

  // verification token (email delivery is optional; the link is surfaced in dev)
  const token = randomToken(24);
  await db.insert(verificationTokens).values({
    userId: user!.id,
    kind: "email",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user!.id)).limit(1);
  const meta = await requestMeta();
  const session = await createSession(user!.id, { tenantId: membership?.tenantId ?? null, ip: meta.ip, userAgent: meta.userAgent }, db);
  await setSessionCookie(session.token, session.expiresAt);
  await db.insert(auditLogs).values({
    tenantId: membership?.tenantId ?? null,
    actorId: user!.id,
    actorEmail: parsed.data.email,
    action: "auth.register",
    entity: "tenant",
    entityId: membership?.tenantId ?? undefined,
    severity: "info",
    metadata: { businessName: parsed.data.businessName, plan: "free" },
  });
  const link = `/verify-email?token=${token}`;
  if (process.env.NODE_ENV !== "production") console.info(`[mervo] email verification link: ${link}`);
  redirect("/dashboard?welcome=1");
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    const ctx = await loadAuthContext(token, db);
    if (ctx) await revokeSession(ctx.sessionId, db);
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function switchWorkspaceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const db = await getDb();
  const ctx = await loadAuthContext(token, db);
  if (!ctx) redirect("/login");
  if (!ctx.memberships.some((m) => m.tenantId === tenantId)) return;
  await switchTenant(ctx.sessionId, tenantId, db);
  redirect("/dashboard");
}

export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address" };
  const limit = await rateLimit({ bucket: "reset", identifier: await clientKey("reset"), limit: 5, windowSeconds: 3600 });
  if (!limit.allowed) return { error: "Too many requests. Try again later." };

  const db = await getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.data)).limit(1);
  const generic = { success: "If that email exists, a reset link has been sent." };
  if (!user) return generic;

  const token = randomToken(24);
  await db.insert(verificationTokens).values({
    userId: user.id,
    kind: "password_reset",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const link = `/reset-password?token=${token}`;
  console.info(`[mervo] password reset link: ${link}`);
  return { ...generic, devLink: process.env.NODE_ENV === "production" ? undefined : link };
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const password = z.string().min(10).safeParse(formData.get("password"));
  const confirm = String(formData.get("confirm") ?? "");
  if (!password.success) return { error: "Password must be at least 10 characters" };
  if (password.data !== confirm) return { error: "Passwords do not match" };

  const db = await getDb();
  const tokenHash = sha256(token);
  const [record] = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, tokenHash), eq(verificationTokens.kind, "password_reset"), isNull(verificationTokens.usedAt)))
    .limit(1);
  if (!record || record.expiresAt < new Date()) return { error: "That reset link is invalid or has expired." };

  await db.update(users).set({ passwordHash: await hashPassword(password.data), failedLogins: 0, lockedUntil: null }).where(eq(users.id, record.userId));
  await db.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, record.id));
  await db.insert(auditLogs).values({ actorId: record.userId, action: "auth.password_reset", severity: "warning" });
  redirect("/login?reset=1");
}

export async function verifyEmailAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const db = await getDb();
  const [record] = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, sha256(token)), eq(verificationTokens.kind, "email"), isNull(verificationTokens.usedAt)))
    .limit(1);
  if (!record || record.expiresAt < new Date()) redirect("/verify-email?invalid=1");
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, record.userId));
  await db.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, record.id));
  redirect("/dashboard?verified=1");
}

export { zJson };
