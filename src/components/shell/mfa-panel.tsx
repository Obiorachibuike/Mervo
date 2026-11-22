"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/misc";
import { confirmMfaAction, startMfaAction } from "@/server/actions/team";

export function MfaPanel({ enabled }: { enabled: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpUrl, setOtpUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (enabled) {
    return <p className="text-[11.5px] muted">Two-factor authentication is protecting this account. Codes are required at every new sign-in.</p>;
  }

  return (
    <div className="space-y-3">
      {!secret ? (
        <Button
          variant="secondary"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await startMfaAction();
              if (result.ok && result.secret) {
                setSecret(result.secret);
                setOtpUrl(result.otpUrl ?? null);
              } else {
                toast.error(result.message ?? "Could not start 2FA setup");
              }
            })
          }
        >
          <ShieldCheck className="size-3.5" /> Set up authenticator
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border)] p-3">
            <p className="text-[11px] muted">Add this key to Google Authenticator, 1Password or Authy.</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="break-all rounded bg-black/5 px-2 py-1 text-[12px] tracking-wider dark:bg-white/10">{secret}</code>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Copy secret"
                onClick={async () => {
                  await navigator.clipboard?.writeText(secret);
                  toast.success("Secret copied");
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            {otpUrl ? <p className="mt-1 break-all text-[10px] muted">{otpUrl.slice(0, 64)}…</p> : null}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await confirmMfaAction(formData);
                if (result.ok) {
                  toast.success(result.message ?? "Two-factor enabled");
                  router.refresh();
                } else {
                  toast.error(result.message ?? "That code was not accepted");
                }
              });
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Field label="6-digit code"><Input name="code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required /></Field>
            <Button type="submit" loading={pending} disabled={code.length !== 6}>Verify & enable</Button>
          </form>
        </div>
      )}
    </div>
  );
}
