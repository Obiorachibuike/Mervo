import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, Sparkles } from "lucide-react";
import { getAuth } from "@/server/auth/session";
import { MervoLogo } from "@/components/brand";
import { Card } from "@/components/ui/card";
import { OnboardingForm } from "@/components/marketing/onboarding-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (auth.tenantId) redirect("/dashboard");

  return (
    <div className="grid min-h-screen bg-[#F6F8F7] lg:grid-cols-[1.1fr_1fr] dark:bg-charcoal">
      <div className="hidden flex-col justify-between bg-charcoal p-10 text-white lg:flex">
        <MervoLogo inverted />
        <div>
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-[-0.02em]">
            One workspace for selling, stocking, staffing and knowing your numbers.
          </h1>
          <ul className="mt-6 space-y-3 text-[13px] text-white/70">
            {[
              "POS that keeps selling when the internet drops",
              "Double-entry books balanced on every transaction",
              "AI answers computed from your real data — never invented",
              "Branches, staff, payroll and a storefront included",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-neon" />{item}</li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-white/40">MERVO · AI-powered business operating system</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <MervoLogo />
          </div>
          <Card className="p-6">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand">
              <Sparkles className="size-3" /> 14-day free trial · no card required
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Set up {auth.user.name.split(" ")[0]}&apos;s workspace</h2>
            <p className="mt-1 text-[12.5px] muted">You can invite your team and add branches right after this.</p>
            <div className="mt-5">
              <OnboardingForm email={auth.user.email} />
            </div>
          </Card>
          <p className="mt-4 text-center text-[11px] muted">
            Already invited to a workspace? Ask your admin to confirm, then sign in again.
          </p>
        </div>
      </div>
    </div>
  );
}
