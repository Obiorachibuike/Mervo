import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth/session";
import { assertPermission, type Permission } from "@/server/auth/permissions";
import { logAudit } from "@/server/auth/session";

/** Builds a permission-checked service context for a server action. */
export async function actionCtx(permission: Permission | Permission[]) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.tenantId) redirect("/onboarding");
  try {
    assertPermission(auth.rawPermissions, permission);
  } catch {
    throw new Error("Your role does not allow this action.");
  }
  const db = await getDb();
  return {
    db,
    tenantId: auth.tenantId,
    userId: auth.user.id,
    permissions: auth.rawPermissions,
    currency: auth.tenant?.currency ?? "NGN",
    auth,
    audit: (input: { action: string; entity?: string; entityId?: string; severity?: "info" | "warning" | "critical"; metadata?: Record<string, unknown> }) =>
      logAudit({ tenantId: auth.tenantId, actorId: auth.user.id, actorEmail: auth.user.email, ...input }),
  };
}

export async function platformCtx() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.user.isSuperAdmin) redirect("/dashboard?denied=admin");
  const db = await getDb();
  return {
    db,
    userId: auth.user.id,
    email: auth.user.email,
    audit: (input: { action: string; entity?: string; entityId?: string; severity?: "info" | "warning" | "critical"; metadata?: Record<string, unknown> }) =>
      logAudit({ actorId: auth.user.id, actorEmail: auth.user.email, ...input }),
  };
}

/** Guards an action result so UI can show a message instead of a stack trace. */
export type ActionResult = { ok: boolean; message?: string };
export function failure(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return { ok: false, message };
}
