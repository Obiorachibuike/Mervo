import Link from "next/link";
import { Building2, CreditCard, History, MapPin, Plug, ShieldCheck, Store, Users } from "lucide-react";
import { getAuth } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Topbar } from "@/components/shell/topbar";
import { PageBody } from "@/components/ui/page";
import { SettingsTabs } from "@/components/shell/settings-tabs";

const TABS = [
  { href: "/settings", label: "Business", icon: Building2, permission: "settings.manage" as const },
  { href: "/settings/branches", label: "Branches", icon: MapPin, permission: "branches.manage" as const },
  { href: "/settings/team", label: "Team & roles", icon: Users, permission: "settings.manage" as const },
  { href: "/settings/billing", label: "Billing", icon: CreditCard, permission: "billing.manage" as const },
  { href: "/settings/storefront", label: "Storefront", icon: Store, permission: "settings.manage" as const },
  { href: "/settings/integrations", label: "Integrations", icon: Plug, permission: "settings.manage" as const },
  { href: "/settings/security", label: "Security", icon: ShieldCheck, permission: "settings.manage" as const },
  { href: "/settings/audit", label: "Audit log", icon: History, permission: "audit.view" as const },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  const tabs = TABS.filter((tab) => hasPermission(auth?.rawPermissions ?? [], tab.permission)).map(({ href, label, icon }) => ({ href, label, icon: icon.displayName ?? label }));
  return (
    <>
      <Topbar title="Settings" subtitle="Workspace, team, billing and security" />
      <PageBody>
        <SettingsTabs tabs={tabs} />
        {children}
        <p className="pt-2 text-[11px] muted">
          Need something else? <Link href="/settings/audit" className="font-medium text-brand">Review the audit log</Link> to see who changed what and when.
        </p>
      </PageBody>
    </>
  );
}
