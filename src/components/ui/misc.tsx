"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn("surface max-h-[92vh] w-full overflow-y-auto rounded-t-2xl shadow-pop sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-xs muted">{description}</p> : null}
          </div>
          <button onClick={onClose} className="focus-ring rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
let pushToast: ((t: Omit<Toast, "id">) => void) | null = null;
export const toast = {
  success: (message: string) => pushToast?.({ message, tone: "success" }),
  error: (message: string) => pushToast?.({ message, tone: "error" }),
  info: (message: string) => pushToast?.({ message, tone: "info" }),
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { ...t, id }]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto animate-fade-in rounded-lg px-4 py-2.5 text-xs font-medium shadow-pop",
            t.tone === "success" && "bg-charcoal text-white dark:bg-white dark:text-charcoal",
            t.tone === "error" && "bg-red-600 text-white",
            t.tone === "info" && "surface",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string }[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto border-b pb-px">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "focus-ring whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            active === t.key ? "border-brand text-[var(--fg)]" : "border-transparent muted hover:text-[var(--fg)]",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
