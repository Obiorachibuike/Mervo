import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/marketing/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthShell title="Invalid link" subtitle="This password reset link is missing its token." footer={<Link href="/forgot-password" className="text-brand hover:underline">Request a new link</Link>}>
        <p className="text-sm muted">Reset links expire after one hour and can only be used once.</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 10 characters with upper, lower case and a number." footer={<Link href="/login" className="text-brand hover:underline">Back to sign in</Link>}>
      <ResetForm token={token} />
    </AuthShell>
  );
}
