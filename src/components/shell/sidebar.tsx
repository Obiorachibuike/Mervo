"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  BrainCircuit,
  Building2,
  ChefHat,
  ChevronsUpDown,
  CreditCard,
  LayoutDashboard,
  Menu,
  Plug,
  ScanBarcode,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { MervoMark } from "@/components/brand";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: string | number; permission?: string };

const ICONS = {
  dashboard: LayoutDashboard,
  pos: ScanBarcode,
  sales: ShoppingBag,
  products: Boxes,
  inventory: Store,
  suppliers: Truck,
  customers: Users,
  finance: Wallet,
  reports: BarChart3,
  employees: Activity,
  restaurant: ChefHat,
  ai: BrainCircuit,
  automation: Activity,
  billing: CreditCard,
  settings: Settings,
  branches: Building2,
  audit: ShieldCheck,
  integrations: Plug,
  admin: ShieldCheck,
  queue: Bell,
};

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operate",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/pos", label: "Point of sale", icon: "pos", permission: "sales.create" },
      { href: "/sales", label: "Sales", icon: "sales", permission: "sales.view" },
      { href: "/restaurant", label: "Restaurant", icon: "restaurant", permission: "restaurant.manage" },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/products", label: "Products", icon: "products", permission: "inventory.view" },
      { href: "/inventory", label: "Inventory", icon: "inventory", permission: "inventory.view" },
      { href: "/suppliers", label: "Suppliers", icon: "suppliers", permission: "inventory.purchase" },
      { href: "/customers", label: "Customers", icon: "customers", permission: "customers.view" },
      { href: "/employees", label: "Employees", icon: "employees", permission: "employees.view" },
    ],
  },
  {
    title: "Understand",
    items: [
      { href: "/ai", label: "MERVO AI", icon: "ai", permission: "ai.assistant.use" },
      { href: "/finance", label: "Finance", icon: "finance", permission: "finance.view" },
      { href: "/reports", label: "Reports", icon: "reports", permission: "reports.view" },
      { href: "/automation", label: "Automations", icon: "automation", permission: "automation.manage" },
    ],
  },
  {
    title: "Configure",
    items: [
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/settings/billing", label: "Billing", icon: "billing", permission: "billing.manage" },
      { href: "/settings/audit", label: "Audit log", icon: "audit", permission: "audit.view" },
    ],
  },
];

export function Sidebar({
  businessName,
  roleName,
  userName,
  userEmail,
  branchName,
  memberships,
  permissions,
  isSuperAdmin,
  switchAction,
}: {
  businessName: string;
  roleName: string;
  userName: string;
  userEmail: string;
  branchName: string;
  memberships: { tenantId: string; tenantName: string }[];
  permissions: string[];
  isSuperAdmin: boolean;
  switchAction: (formData: FormData) => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const can = (permission?: string) => !permission || permissions.includes("*") || permissions.includes(permission);

  const body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="MERVO dashboard">
          <MervoMark inverted className="h-7 w-7" />
          <span className="text-[15px] font-extrabold tracking-[-0.04em] text-white">MERVO</span>
        </Link>
        <button className="rounded p-1 text-white/60 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation">
          <X size={16} />
        </button>
      </div>

      <div className="mx-3 rounded-lg bg-white/[0.06] px-3 py-2.5">
        <p className="truncate text-[12px] font-semibold text-white">{businessName}</p>
        <p className="mt-0.5 truncate text-[10px] text-white/40">
          {roleName} · {branchName}
        </p>
        {memberships.length > 1 ? (
          <form action={switchAction} className="mt-2">
            <div className="relative">
              <select
                name="tenantId"
                defaultValue=""
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="w-full appearance-none rounded-md border border-white/10 bg-black/30 px-2 py-1.5 pr-6 text-[10px] text-white/70"
                aria-label="Switch workspace"
              >
                <option value="" disabled>
                  Switch workspace…
                </option>
                {memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName}
                  </option>
                ))}
              </select>
              <ChevronsUpDown size={10} className="pointer-events-none absolute right-2 top-2 text-white/40" />
            </div>
          </form>
        ) : null}
      </div>

      <nav className="scroll-thin mt-4 flex-1 overflow-y-auto px-2 pb-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => can(i.permission));
          if (!items.length) return null;
          return (
            <div key={group.title} className="mb-4">
              <p className="px-3 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">{group.title}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] transition-colors",
                          active ? "bg-white text-charcoal font-medium" : "text-white/65 hover:bg-white/[0.07] hover:text-white",
                        )}
                      >
                        <Icon size={15} className={active ? "text-charcoal" : "text-white/45"} />
                        {item.label}
                        {item.href === "/pos" ? (
                          <span className="ml-auto rounded bg-neon px-1.5 py-px text-[9px] font-semibold text-charcoal">F2</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {isSuperAdmin ? (
          <div className="mt-2 border-t border-white/10 pt-3">
            <p className="px-3 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">Platform</p>
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] transition-colors",
                pathname.startsWith("/admin") ? "bg-neon text-charcoal font-medium" : "text-white/65 hover:bg-white/[0.07] hover:text-white",
              )}
            >
              <ShieldCheck size={15} className={pathname.startsWith("/admin") ? "text-charcoal" : "text-white/45"} />
              Super admin
            </Link>
          </div>
        ) : null}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon text-[11px] font-bold text-charcoal">
            {initials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] font-medium text-white">{userName}</p>
            <p className="truncate text-[10px] text-white/40">{userEmail}</p>
          </div>
          <Link href="/settings" className="rounded p-1 text-white/40 hover:text-white" aria-label="Settings">
            <Settings size={14} />
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] bg-charcoal lg:block dark:bg-[#080b0d]">{body}</aside>
      <button
        onClick={() => setOpen(true)}
        className="focus-ring fixed bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-charcoal text-white shadow-pop lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-[268px] bg-charcoal">{body}</aside>
        </div>
      ) : null}
    </>
  );
}
