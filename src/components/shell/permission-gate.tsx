import { Lock } from "lucide-react";
import { getAuth } from "@/server/auth/session";
import { hasPermission, type Permission } from "@/server/auth/permissions";
import { LinkButton } from "@/components/ui/link-button";

/**
 * Renders children only when the signed-in user holds the permission.
 * Server components use this so unauthorised content never reaches the client.
 */
export async function PagePermission({
  permission,
  children,
  fallback,
}: {
  permission: Permission | Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const auth = await getAuth();
  if (!auth) return null;
  if (hasPermission(auth.rawPermissions, permission)) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-charcoal/15 bg-white/60 px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-charcoal/5 text-charcoal/50">
            <Lock className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold">You do not have access to this area</h2>
          <p className="mt-1 max-w-sm text-sm text-charcoal/55">
            Your role does not include this permission. Ask an owner or administrator to update your access.
          </p>
          <LinkButton href="/dashboard" variant="outline" size="sm" className="mt-5">
            Back to dashboard
          </LinkButton>
        </div>
      )}
    </>
  );
}
