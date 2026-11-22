import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import { getAuth } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; email?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  if (auth) redirect(auth.user.isSuperAdmin && !auth.tenantId ? "/admin" : "/dashboard");

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your workspace to continue."
      footer={
        <>
          New to MERVO?{" "}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Create a business account
          </Link>
        </>
      }
    >
      {params.reset ? (
        <p className="mb-4 rounded-lg bg-brand/10 px-3 py-2 text-xs font-medium text-brand-dark dark:text-brand">
          Your password has been reset. Sign in with your new password.
        </p>
      ) : null}
      <LoginForm />
      <div className="mt-6 rounded-lg border border-dashed px-3 py-2.5 text-[11px] muted">
        <p className="font-medium text-[var(--fg)]">Demo workspace</p>
        <p className="mt-0.5">owner@mervo.app · MervoDemo#2025</p>
        <p>Platform admin: admin@mervo.app · MervoAdmin#2025</p>
      </div>
    </AuthShell>
  );
}
