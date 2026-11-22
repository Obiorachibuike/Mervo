import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-charcoal text-white hover:bg-[#1b232a] dark:bg-white dark:text-charcoal dark:hover:bg-[#e7ecea]",
  secondary: "bg-brand text-white hover:bg-brand-dark",
  neon: "bg-neon text-charcoal hover:brightness-95",
  ghost: "bg-transparent hover:bg-black/5 dark:hover:bg-white/10",
  danger: "bg-red-600 text-white hover:bg-red-700",
  outline: "border border-[var(--border)] bg-transparent hover:bg-black/5 dark:hover:bg-white/10",
} as const;
const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[15px] gap-2", icon: "h-9 w-9 justify-center" } as const;

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  children: ReactNode;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "focus-ring inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
