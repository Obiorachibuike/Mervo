"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/misc";
import { createWorkspaceAction } from "@/server/actions/onboarding";

const INDUSTRIES = [
  ["retail", "Retail shop"],
  ["supermarket", "Supermarket / grocery"],
  ["restaurant", "Restaurant / bar"],
  ["pharmacy", "Pharmacy"],
  ["fashion", "Fashion & apparel"],
  ["electronics", "Electronics"],
  ["wholesale", "Wholesale / distribution"],
  ["services", "Services"],
] as const;

export function OnboardingForm({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [currency, setCurrency] = useState("NGN");
  const [industry, setIndustry] = useState("retail");
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createWorkspaceAction(formData);
          if (result.ok) {
            toast.success(result.message ?? "Workspace ready");
            router.push("/dashboard");
            router.refresh();
          } else {
            toast.error(result.message ?? "Could not create the workspace");
          }
        });
      }}
    >
      <Field label="Business name *">
        <Input name="businessName" required placeholder="Mervo Mart" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Industry">
          <Select name="industry" value={industry} onChange={(event) => setIndustry(event.target.value)}>
            {INDUSTRIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="NGN">NGN ₦</option>
            <option value="USD">USD $</option>
            <option value="EUR">EUR €</option>
            <option value="GBP">GBP £</option>
          </Select>
        </Field>
      </div>
      <Field label="Country">
        <Select name="country" defaultValue="NG">
          <option value="NG">Nigeria</option>
          <option value="GH">Ghana</option>
          <option value="KE">Kenya</option>
          <option value="ZA">South Africa</option>
          <option value="GB">United Kingdom</option>
          <option value="US">United States</option>
        </Select>
      </Field>
      <Field label="Starting plan">
        <Select name="planCode" defaultValue="free">
          <option value="free">Free — start simple</option>
          <option value="starter">Starter — ₦12,000/mo</option>
          <option value="growth">Growth — ₦35,000/mo</option>
          <option value="business">Business — ₦75,000/mo</option>
        </Select>
      </Field>
      <div className="space-y-1.5 pt-1">
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="withRestaurant" defaultChecked={industry === "restaurant"} className="size-4 rounded border-[var(--border)]" />
          Add restaurant tables and a kitchen display
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="seedCatalogue" className="size-4 rounded border-[var(--border)]" />
          Pre-fill a sample catalogue I can edit
        </label>
      </div>
      <Button type="submit" className="w-full" loading={pending}>Create workspace</Button>
      <p className="text-center text-[10.5px] muted">Signed in as {email}</p>
    </form>
  );
}
