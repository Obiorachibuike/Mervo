import Link from "next/link";
import { LogOut, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";

export function Topbar({
  title,
  subtitle,
  actions,
  showAi = true,
  emailVerified = true,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  showAi?: boolean;
  emailVerified?: boolean;
}) {
  return (
    <div className="sticky top-0 z-20 border-b bg-[var(--bg)]/90 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle ? <p className="mt-0.5 truncate text-[11.5px] muted">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          {showAi ? (
            <Link href="/ai" className="hidden sm:block">
              <Button variant="outline" size="sm">
                <Sparkles size={13} className="text-brand" /> Ask MERVO
              </Button>
            </Link>
          ) : null}
          <ThemeToggle />
          <form action={logoutAction}>
            <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
              <LogOut size={15} />
            </Button>
          </form>
        </div>
      </div>
      {!emailVerified ? (
        <div className="border-t bg-amber-500/10 px-4 py-2 text-[11px] text-amber-800 dark:text-amber-300 sm:px-6">
          Your email is not verified yet — some notifications and password recovery will be limited.{" "}
          <Link href="/verify-email" className="font-medium underline">
            Verify now
          </Link>
        </div>
      ) : null}
    </div>
  );
}
