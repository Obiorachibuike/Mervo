"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/tenants", label: "Workspaces" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/ai", label: "AI providers" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/support", label: "Support" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto pb-px" aria-label="Admin sections">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
              active ? "border-neon text-white" : "border-transparent text-white/55 hover:text-white",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
