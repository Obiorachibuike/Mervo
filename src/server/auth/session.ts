import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { assertPermission, type Permission } from "./permissions";
import {
  loadAuthContext,
  requireTenant,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  type AuthContext,
} from "./session-core";

/** Per-request memoised auth context. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  try {
    return await loadAuthContext(token);
  } catch (error) {
    console.error("auth resolution failed", error);
    return null;
  }
});

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireWorkspace(permission?: Permission | Permission[]): Promise<
  AuthContext & { tenantId: string; tenant: NonNullable<AuthContext["tenant"]> }
> {
  const ctx = await requireAuth();
  if (!ctx.tenantId) redirect("/onboarding");
  const scoped = requireTenant(ctx);
  if (permission) {
    try {
      assertPermission(scoped.rawPermissions, permission);
    } catch {
      redirect("/dashboard?denied=" + encodeURIComponent(Array.isArray(permission) ? permission[0]! : permission));
    }
  }
  return scoped;
}

export async function requireSuperAdminPage(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!ctx.user.isSuperAdmin) redirect("/dashboard?denied=admin");
  return ctx;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

export async function logAudit(input: {
  tenantId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}) {
  try {
    const db = await getDb();
    const meta = await requestMeta();
    await db.insert(auditLogs).values({
      tenantId: input.tenantId ?? null,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      severity: input.severity ?? "info",
      metadata: input.metadata ?? {},
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  } catch (error) {
    console.error("audit log failed", error);
  }
}
