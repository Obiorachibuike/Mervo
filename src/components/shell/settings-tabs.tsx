"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs({ tabs }: { tabs: { href: string; label: string; icon: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5" aria-label="Settings sections">
      {tabs.map((tab) => {
        const active = tab.href === "/settings" ? pathname === "/settings" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-xl px-3 py-1.5 text-[12px] font-medium transition-colors",
              active ? "bg-charcoal text-white dark:bg-white dark:text-charcoal" : "muted hover:bg-black/5 dark:hover:bg-white/10",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
