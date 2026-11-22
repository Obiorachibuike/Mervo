"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/misc";

export function MemberRoleForm({
  membershipId,
  roleKey,
  roles,
  action,
}: {
  membershipId: string;
  roleKey: string;
  roles: { key: string; name: string }[];
  action: (formData: FormData) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      onChange={(event) => {
        const formData = new FormData(event.currentTarget);
        formData.set("membershipId", membershipId);
        startTransition(async () => {
          const result = await action(formData);
          if (result.ok) {
            toast.success(result.message ?? "Role updated");
            router.refresh();
          } else {
            toast.error(result.message ?? "Could not update the role");
          }
        });
      }}
    >
      <Select name="roleKey" defaultValue={roleKey} disabled={pending} className="h-7 w-[150px] text-[11px]" aria-label="Change role">
        {roles.map((role) => (
          <option key={role.key} value={role.key}>{role.name}</option>
        ))}
      </Select>
    </form>
  );
}
