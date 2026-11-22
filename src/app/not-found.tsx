import Link from "next/link";
import { MervoLogo } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F6F8F7] px-6 text-center dark:bg-charcoal">
      <MervoLogo />
      <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">We could not find that page</h1>
      <p className="mt-2 max-w-sm text-[13px] muted">
        The link may be old, or the record may belong to another workspace. Try your dashboard or search from there.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/dashboard" className="rounded-lg bg-charcoal px-4 py-2 text-[13px] font-medium text-white dark:bg-white dark:text-charcoal">Dashboard</Link>
        <Link href="/pos" className="rounded-lg border border-charcoal/15 px-4 py-2 text-[13px] font-medium">Open POS</Link>
      </div>
    </main>
  );
}
