"use client";

import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form";
import { resetPasswordAction, type ActionState } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(resetPasswordAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">{state.error}</p> : null}
      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" required autoComplete="new-password" />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" />
      </div>
      <SubmitButton className="w-full" size="lg">
        Update password
      </SubmitButton>
    </form>
  );
}
