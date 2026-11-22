import Link from "next/link";
import { MervoLogo } from "@/components/brand";
import { CheckCircle2 } from "lucide-react";

const PROOF = [
  "Fast offline-capable POS with split payments",
  "AI inventory forecasting and reorder advice",
  "Double-entry accounting that actually balances",
  "Multi-branch, multi-role, multi-currency",
];

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-charcoal p-10 text-white lg:flex">
        <div className="absolute inset-0 grid-lines opacity-[0.18]" aria-hidden />
        <div className="absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-neon/10 blur-3xl" aria-hidden />
        <Link href="/" className="relative">
          <MervoLogo inverted showTag />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
            The operating system for businesses that intend to grow.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Sales, stock, staff, money and decisions in one place — with an AI analyst that answers using your real ledger, never guesses.
          </p>
          <ul className="mt-8 space-y-3">
            {PROOF.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-neon" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-3 text-[11px] text-white/40">
          <span className="rounded-md border border-white/15 px-2 py-1">SOC-style audit trail</span>
          <span className="rounded-md border border-white/15 px-2 py-1">Tenant-isolated data</span>
          <span className="rounded-md border border-white/15 px-2 py-1">NGN · USD · EUR · GBP</span>
        </div>
      </div>
      <div className="flex min-h-screen flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link href="/">
              <MervoLogo showTag />
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-1.5 text-sm muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-xs muted">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
