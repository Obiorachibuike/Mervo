"use client";

import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form";
import { loginAction, type ActionState } from "../actions";

export function LoginForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(loginAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@business.com" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <a href="/forgot-password" className="mb-1.5 text-[11px] font-medium text-brand hover:underline">
            Forgot password?
          </a>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••••" />
      </div>
      {state?.requiresMfa ? (
        <div>
          <Label htmlFor="totp">Authenticator code</Label>
          <Input id="totp" name="totp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="123456" autoFocus />
        </div>
      ) : null}
      <SubmitButton className="w-full" size="lg">
        Sign in to MERVO
      </SubmitButton>
    </form>
  );
}
