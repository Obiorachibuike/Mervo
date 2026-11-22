import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { memberships, roles, sessions, tenants, users } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/lib/crypto";
import { resolvePermissions, type Permission, type RoleKey } from "./permissions";

export const SESSION_COOKIE = "mervo_session";
export const SESSION_TTL_DAYS = 14;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  mfaEnabled: boolean;
};

export type MembershipSummary = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  roleKey: RoleKey | string;
  roleName: string;
  branchId: string | null;
  permissions: Permission[];
  rawPermissions: string[];
};

export type AuthContext = {
  sessionId: string;
  user: SessionUser;
  memberships: MembershipSummary[];
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string; status: string; currency: string } | null;
  roleKey: string | null;
  permissions: Permission[];
  rawPermissions: string[];
  branchId: string | null;
  mfaVerified: boolean;
};

export async function createSession(
  userId: string,
  opts: { tenantId?: string | null; ip?: string | null; userAgent?: string | null; mfaVerified?: boolean } = {},
  db?: Db,
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const d = db ?? (await getDb());
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await d
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      activeTenantId: opts.tenantId ?? null,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 400) ?? null,
      mfaVerified: opts.mfaVerified ?? false,
      expiresAt,
    })
    .returning({ id: sessions.id });
  return { token, expiresAt, sessionId: row!.id };
}

export async function loadAuthContext(token: string | undefined | null, db?: Db): Promise<AuthContext | null> {
  if (!token) return null;
  const d = db ?? (await getDb());
  const rows = await d
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const found = rows[0];
  if (!found) return null;

  const memberRows = await d
    .select({ membership: memberships, role: roles, tenant: tenants })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, found.user.id), eq(memberships.status, "active")));

  const list: MembershipSummary[] = memberRows.map(({ membership, role, tenant }) => ({
    tenantId: membership.tenantId,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    tenantStatus: tenant.status,
    roleKey: role.key,
    roleName: role.name,
    branchId: membership.branchId,
    permissions: resolvePermissions(role.permissions ?? []),
    rawPermissions: role.permissions ?? [],
  }));

  const preferred =
    list.find((m) => m.tenantId === found.session.activeTenantId) ??
    list.find((m) => m.tenantId === found.user.defaultTenantId) ??
    list[0] ??
    null;

  const tenantRow = found.session.activeTenantId ?? preferred?.tenantId ?? null;
  const activeTenant = tenantRow
    ? memberRows.find((r) => r.membership.tenantId === tenantRow && r.membership.userId === found.user.id)?.tenant ?? null
    : null;

  return {
    sessionId: found.session.id,
    user: {
      id: found.user.id,
      email: found.user.email,
      name: found.user.name,
      avatarUrl: found.user.avatarUrl,
      isSuperAdmin: found.user.isSuperAdmin,
      mfaEnabled: found.user.mfaEnabled,
    },
    memberships: list,
    tenantId: activeTenant?.id ?? null,
    tenant: activeTenant
      ? { id: activeTenant.id, name: activeTenant.name, slug: activeTenant.slug, status: activeTenant.status, currency: activeTenant.currency }
      : null,
    roleKey: preferred?.roleKey ?? null,
    permissions: activeTenant ? (preferred?.permissions ?? []) : [],
    rawPermissions: activeTenant ? (preferred?.rawPermissions ?? []) : [],
    branchId: preferred?.branchId ?? null,
    mfaVerified: found.session.mfaVerified,
  };
}

export async function switchTenant(sessionId: string, tenantId: string, db?: Db): Promise<void> {
  const d = db ?? (await getDb());
  await d.update(sessions).set({ activeTenantId: tenantId }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(sessionId: string, db?: Db): Promise<void> {
  const d = db ?? (await getDb());
  await d.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string, db?: Db): Promise<void> {
  const d = db ?? (await getDb());
  const rows = await d.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const row of rows) if (row.id !== exceptSessionId) await revokeSession(row.id, d);
}

export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class NoTenantError extends Error {
  constructor(message = "No active business workspace") {
    super(message);
    this.name = "NoTenantError";
  }
}

/** Require a signed-in user with an active tenant workspace. */
export function requireTenant(ctx: AuthContext | null): AuthContext & { tenantId: string; tenant: NonNullable<AuthContext["tenant"]> } {
  if (!ctx) throw new UnauthenticatedError();
  if (!ctx.tenantId || !ctx.tenant) throw new NoTenantError();
  return ctx as AuthContext & { tenantId: string; tenant: NonNullable<AuthContext["tenant"]> };
}

export function requireSuperAdmin(ctx: AuthContext | null): AuthContext {
  if (!ctx) throw new UnauthenticatedError();
  if (!ctx.user.isSuperAdmin) throw new Error("Super admin access required");
  return ctx;
}
