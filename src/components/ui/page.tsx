import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p> : null}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description ? <p className="mt-0.5 max-w-2xl text-[12.5px] muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-[13px] font-semibold tracking-tight">{children}</h3>
      {hint ? <span className="text-[11px] muted">{hint}</span> : null}
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5 p-4 sm:p-6", className)}>{children}</div>;
}

export function Disclosure({
  title,
  description,
  children,
  cta = "Open",
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  cta?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className="surface group rounded-2xl" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">{title}</span>
          {description ? <span className="mt-0.5 block text-[11.5px] muted">{description}</span> : null}
        </span>
        <span className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium group-open:hidden">{cta}</span>
        <span className="hidden shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium group-open:inline">Close</span>
      </summary>
      <div className="border-t border-[var(--border)] p-4">{children}</div>
    </details>
  );
}
