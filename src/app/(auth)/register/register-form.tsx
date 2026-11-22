"use client";

import { useActionState } from "react";
import { Input, Label, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form";
import { registerAction, type ActionState } from "../actions";

const industries = [
  ["retail", "General retail"],
  ["supermarket", "Supermarket / grocery"],
  ["restaurant", "Restaurant / hospitality"],
  ["pharmacy", "Pharmacy"],
  ["electronics", "Electronics & phone accessories"],
  ["fashion", "Fashion"],
  ["wholesale", "Wholesale / distribution"],
  ["hotel", "Hotel"],
];

export function RegisterForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(registerAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" autoComplete="name" required placeholder="Amaka Obi" />
        </div>
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input id="businessName" name="businessName" required placeholder="Mervo Mart" />
        </div>
      </div>
      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@business.com" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required placeholder="At least 10 characters" />
        <p className="mt-1 text-[11px] muted">Use 10+ characters with upper, lower case and a number.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="industry">Industry</Label>
          <Select id="industry" name="industry" defaultValue="retail">
            {industries.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Select id="currency" name="currency" defaultValue="NGN">
            {[["NGN", "NGN — Naira"], ["USD", "USD — Dollar"], ["EUR", "EUR — Euro"], ["GBP", "GBP — Pound"], ["KES", "KES — Shilling"], ["GHS", "GHS — Cedi"], ["ZAR", "ZAR — Rand"]].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
      </div>
      <input type="hidden" name="country" value="NG" />
      <SubmitButton className="w-full" size="lg">
        Create my workspace
      </SubmitButton>
      <p className="text-[11px] muted">
        By creating an account you agree to the MERVO terms of service and privacy policy. Your workspace starts on the Free plan with a 14-day trial of paid features.
      </p>
    </form>
  );
}
