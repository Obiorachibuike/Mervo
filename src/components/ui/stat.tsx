import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "positive" | "warning" | "critical";
  className?: string;
}) {
  const toneRing = {
    default: "",
    positive: "text-brand",
    warning: "text-amber-600 dark:text-amber-400",
    critical: "text-red-600 dark:text-red-400",
  }[tone];
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide muted">{label}</p>
        {icon ? <span className={cn("text-[var(--fg-muted)]", toneRing)}>{icon}</span> : null}
      </div>
      <p className={cn("mt-2 text-xl font-semibold tracking-tight", toneRing)}>{value}</p>
      {hint ? <div className="mt-1 text-[11px] muted">{hint}</div> : null}
    </Card>
  );
}
