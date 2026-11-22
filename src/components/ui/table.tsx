import * as React from "react";
import { cn } from "@/lib/utils";

export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("scroll-thin w-full overflow-x-auto", className)}>{children}</div>;
}
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide muted", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b px-4 py-3 align-middle", className)} {...props} />;
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]", className)} {...props} />;
}
