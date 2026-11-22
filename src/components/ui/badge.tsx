import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-black/5 text-[var(--fg)] dark:bg-white/10",
  success: "bg-brand/10 text-brand-dark dark:text-brand",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-red-500/15 text-red-700 dark:text-red-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  neon: "bg-neon/20 text-charcoal dark:text-neon",
} as const;

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium", tones[tone], className)} {...props} />;
}
