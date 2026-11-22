import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuth } from "@/server/auth/session";
import { MervoLogo } from "@/components/brand";
import { AdminNav } from "@/components/shell/admin-nav";
import { Button } from "@/components/ui/button";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.user.isSuperAdmin) redirect("/dashboard?denied=admin");

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="border-b border-[var(--border)] bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <MervoLogo inverted />
            <span className="rounded-md bg-neon/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neon">Super admin</span>
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-white/60">
            <span className="hidden sm:inline">{auth.user.email}</span>
            <Link href="/dashboard"><Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">Exit to app</Button></Link>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
