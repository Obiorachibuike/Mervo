"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form";
import { requestPasswordResetAction, type ActionState } from "../actions";

export function ForgotForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(requestPasswordResetAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">{state.error}</p> : null}
      {state?.success ? (
        <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand-dark dark:text-brand">
          <p>{state.success}</p>
          {state.devLink ? (
            <p className="mt-1 break-all">
              Development link:{" "}
              <Link className="underline" href={state.devLink}>
                {state.devLink}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      <div>
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" required placeholder="you@business.com" />
      </div>
      <SubmitButton className="w-full" size="lg">
        Send reset link
      </SubmitButton>
    </form>
  );
}
