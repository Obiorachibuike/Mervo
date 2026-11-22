"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MervoLogo } from "@/components/brand";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[mervo] unhandled error", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F6F8F7] px-6 text-center dark:bg-charcoal">
      <MervoLogo />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-[13px] muted">
        The page hit an unexpected error. Your data is safe — nothing was partially saved. If this keeps happening, share the reference below with support.
      </p>
      {error.digest ? <code className="rounded bg-black/5 px-2 py-1 text-[11px] dark:bg-white/10">reference {error.digest}</code> : null}
      <Button onClick={reset} className="mt-2">
        <RotateCcw className="size-4" /> Try again
      </Button>
    </main>
  );
}
