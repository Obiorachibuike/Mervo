import Link from "next/link";
import { MervoLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme";

export function MarketingNav({ transparent = false }: { transparent?: boolean }) {
  return (
    <header className={transparent ? "absolute inset-x-0 top-0 z-40" : "sticky top-0 z-40 border-b bg-[var(--bg)]/85 backdrop-blur"}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" aria-label="MERVO home">
          <MervoLogo showTag />
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] font-medium md:flex">
          <Link href="/#platform" className="muted transition-colors hover:text-[var(--fg)]">Platform</Link>
          <Link href="/#ai" className="muted transition-colors hover:text-[var(--fg)]">AI</Link>
          <Link href="/#industries" className="muted transition-colors hover:text-[var(--fg)]">Industries</Link>
          <Link href="/pricing" className="muted transition-colors hover:text-[var(--fg)]">Pricing</Link>
          <Link href="/store/mervo-demo-mart" className="muted transition-colors hover:text-[var(--fg)]">Live storefront</Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/register">
            <Button size="sm">Start free</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <MervoLogo showTag />
            <p className="mt-4 max-w-xs text-xs leading-relaxed muted">
              MERVO is an intelligent business operating system: POS, inventory, finance, staff and AI analytics in one
              tenant-isolated platform. Built in Lagos for businesses everywhere.
            </p>
          </div>
          {[
            { title: "Platform", links: [["Point of sale", "/#platform"], ["Inventory & AI", "/#ai"], ["Accounting", "/#finance"], ["Restaurant", "/#industries"]] },
            { title: "Company", links: [["Pricing", "/pricing"], ["Storefront demo", "/store/mervo-demo-mart"], ["Sign in", "/login"], ["Create account", "/register"]] },
            { title: "Trust", links: [["Tenant isolation", "/#security"], ["Audit trail", "/#security"], ["Data ownership", "/#security"], ["System status", "/api/health"]] },
          ].map((col) => (
            <div key={col.title}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] muted">{col.title}</p>
              <ul className="mt-3 space-y-2 text-xs">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href!} className="muted transition-colors hover:text-[var(--fg)]">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t pt-6 text-[11px] muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} MERVO. Intelligent Business Management and AI-Powered POS Platform.</p>
          <p className="flex items-center gap-3">
            <span>Lagos · London · Remote</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> All systems operational
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
