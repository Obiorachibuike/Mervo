"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";

export function ProviderTestButton({ providerId }: { providerId: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      onClick={async () => {
        setPending(true);
        try {
          const response = await fetch("/api/admin/ai/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ providerId }),
          });
          const payload = (await response.json()) as { ok?: boolean; data?: { ok: boolean; latencyMs: number; error?: string; model?: string }; error?: string };
          if (payload.data?.ok) toast.success(`Connection healthy · ${payload.data.latencyMs}ms · ${payload.data.model ?? "model"}`);
          else toast.error(payload.data?.error ?? payload.error ?? "Connection failed");
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Test failed");
        } finally {
          setPending(false);
        }
      }}
    >
      <Plug className="size-3" /> Test
    </Button>
  );
}
