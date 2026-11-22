/**
 * MERVO background worker (persistent Node.js process, not a serverless function).
 *
 *   npm run worker
 *
 * Deployment: run on any always-on Node host (Railway, Render, Fly.io, a VPS,
 * Docker) against the production DATABASE_URL. It polls the durable job_queue
 * table with SKIP LOCKED, retries with exponential backoff and shuts down
 * gracefully on SIGTERM/SIGINT.
 */
import { getDb } from "@/server/db";
import { claimNext, completeJob, failJob } from "./queue";
import { processJob } from "./handlers";

const WORKER_ID = `${process.env.WORKER_NAME ?? "mervo-worker"}:${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
let running = true;
const startedAt = new Date();
let processed = 0;
let failed = 0;

async function loop() {
  const db = await getDb();
  console.log(`[mervo-worker] ${WORKER_ID} started at ${startedAt.toISOString()}`);
  while (running) {
    try {
      const job = await claimNext(db, WORKER_ID);
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      const begin = Date.now();
      try {
        const result = await processJob(db, job);
        await completeJob(db, job.id);
        processed++;
        console.log(`[mervo-worker] ✓ ${job.name} (${job.id}) in ${Date.now() - begin}ms`, JSON.stringify(result).slice(0, 200));
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        const outcome = await failJob(db, job.id, message, job.attempts, job.maxAttempts);
        console.error(`[mervo-worker] ✗ ${job.name} (${job.id}) attempt ${job.attempts}: ${message}`, outcome);
      }
      if (process.send) process.send({ type: "health", processed, failed, uptimeMs: Date.now() - startedAt.getTime() });
    } catch (error) {
      console.error("[mervo-worker] poll error", error);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  console.log(`[mervo-worker] stopped. processed=${processed} failed=${failed}`);
  process.exit(0);
}

async function shutdown(signal: string) {
  console.log(`[mervo-worker] ${signal} received — finishing current job then exiting`);
  running = false;
  setTimeout(() => process.exit(0), 10_000);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("[mervo-worker] unhandled rejection", reason));

loop().catch((error) => {
  console.error("[mervo-worker] fatal", error);
  process.exit(1);
});

export const health = () => ({ workerId: WORKER_ID, startedAt, processed, failed, running });
