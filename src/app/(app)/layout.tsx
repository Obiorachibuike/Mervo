import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Sidebar } from "@/components/shell/sidebar";
import { switchWorkspaceAction } from "@/app/(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.tenantId) redirect(auth.user.isSuperAdmin ? "/admin" : "/onboarding");

  const db = await getDb();
  const [branch] = auth.branchId
    ? await db.select({ name: branches.name }).from(branches).where(eq(branches.id, auth.branchId))
    : await db.select({ name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId)).limit(1);

  const membership = auth.memberships.find((m) => m.tenantId === auth.tenantId);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Sidebar
        businessName={auth.tenant?.name ?? "Workspace"}
        roleName={membership?.roleName ?? "Member"}
        userName={auth.user.name}
        userEmail={auth.user.email}
        branchName={branch?.name ?? "All branches"}
        memberships={auth.memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenantName }))}
        permissions={auth.rawPermissions}
        isSuperAdmin={auth.user.isSuperAdmin}
        switchAction={switchWorkspaceAction}
      />
      <main className="lg:pl-[236px]">{children}</main>
    </div>
  );
}
