import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "../actions";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; invalid?: string }> }) {
  const { token, invalid } = await searchParams;
  return (
    <AuthShell title="Verify your email" subtitle="Confirm your address to unlock receipts, alerts and password recovery.">
      {invalid ? <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">That verification link is invalid or has expired.</p> : null}
      {token ? (
        <form action={verifyEmailAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" size="lg" className="w-full">
            Confirm my email address
          </Button>
        </form>
      ) : (
        <div className="space-y-3 text-sm muted">
          <p>Open the verification link from your welcome email to confirm this address.</p>
          <p className="text-[11px]">No email provider is configured on this deployment, so MERVO surfaces the link in the server log instead.</p>
        </div>
      )}
      <p className="mt-6 text-xs muted">
        <Link href="/dashboard" className="font-medium text-brand hover:underline">
          Continue to my dashboard
        </Link>
      </p>
    </AuthShell>
  );
}
