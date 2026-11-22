"use client";

import { useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "./misc";
import { Button } from "./button";

export type ActionResult = { ok: boolean; message?: string };

/**
 * Progressive-enhancement form wrapper for server actions.
 * Shows pending state, toasts the action result and refreshes server data.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  refresh = true,
  successMessage,
  onSuccess,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode | ((state: { pending: boolean }) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  refresh?: boolean;
  successMessage?: string;
  onSuccess?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className={cn(className)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (result.ok) {
              toast.success(result.message ?? successMessage ?? "Saved");
              if (resetOnSuccess) form.reset();
              onSuccess?.();
              if (refresh) router.refresh();
            } else {
              toast.error(result.message ?? "That did not work — please check the details and try again.");
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Unexpected error");
          }
        });
      }}
    >
      {typeof children === "function" ? children({ pending }) : children}
      <noscript>
        <p className="mt-2 text-[11px] text-amber-600">JavaScript is required to submit this form.</p>
      </noscript>
    </form>
  );
}

export function ActionButton({
  action,
  children,
  confirm,
  variant = "outline",
  size = "sm",
  className,
  payload,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline" | "neon";
  size?: "sm" | "md" | "lg" | "icon";
  className?: string;
  payload?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="inline"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const formData = payload ? Object.entries(payload).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData()) : new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await action(formData);
          if (result.ok) {
            if (result.message) toast.success(result.message);
            router.refresh();
          } else {
            toast.error(result.message ?? "Action failed");
          }
        });
      }}
    >
      <Button type="submit" variant={variant} size={size} className={className} loading={pending}>
        {children}
      </Button>
    </form>
  );
}
