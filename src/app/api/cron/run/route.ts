import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { claimNext, completeJob, failJob } from "@/server/jobs/queue";
import { processJob } from "@/server/jobs/handlers";
import { safeEqual } from "@/server/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serverless-safe job drain for Vercel Cron (or any external scheduler).
 * The persistent worker (`npm run worker`) remains the primary processor; this
 * endpoint exists so scheduled work still runs when no long-lived worker is up.
 * Protected by CRON_SECRET (Authorization: Bearer … or ?secret=).
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("secret") ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!safeEqual(provided, secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const started = Date.now();
  const processed: { name: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < 25; i++) {
    if (Date.now() - started > 45_000) break;
    const job = await claimNext(db, `cron:${process.pid}`);
    if (!job) break;
    try {
      await processJob(db, job);
      await completeJob(db, job.id);
      processed.push({ name: job.name, ok: true });
    } catch (error) {
      await failJob(db, job.id, error instanceof Error ? error.message : "failed", job.attempts, job.maxAttempts);
      processed.push({ name: job.name, ok: false, error: error instanceof Error ? error.message : "failed" });
    }
  }
  return NextResponse.json({ ok: true, processed: processed.length, jobs: processed, durationMs: Date.now() - started });
}

export const GET = run;
export const POST = run;
