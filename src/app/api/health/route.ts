import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { dbKind, getDb, isPostgres } from "@/server/db";
import { queueStats } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    const [{ now } = { now: new Date() }] = (await db.execute(sql`select now() as now`)).rows as { now: Date }[];
    const jobs = await queueStats(db);
    return NextResponse.json({
      status: "ok",
      service: "mervo",
      version: "1.0.0",
      database: { driver: await dbKind(), managed: isPostgres(), reachable: true, serverTime: now },
      jobs,
      integrations: {
        agnes: Boolean(process.env.AGNES_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        huggingface: Boolean(process.env.HF_TOKEN),
        paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
        flutterwave: Boolean(process.env.FLUTTERWAVE_SECRET_KEY),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      },
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { status: "degraded", error: error instanceof Error ? error.message : "unknown", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
