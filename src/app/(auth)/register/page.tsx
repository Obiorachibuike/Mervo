import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import { getAuth } from "@/server/auth/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function RegisterPage() {
  const auth = await getAuth();
  if (auth) redirect(auth.tenantId ? "/dashboard" : "/onboarding");
  return (
    <AuthShell
      title="Start with MERVO"
      subtitle="Create your business workspace in under a minute. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
