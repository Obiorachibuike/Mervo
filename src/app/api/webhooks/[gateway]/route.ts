import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { webhookEvents } from "@/server/db/schema";
import { verifyWebhook, type Gateway } from "@/server/payments/gateways";
import { applyBillingEvent } from "@/server/services/subscriptions";

export const dynamic = "force-dynamic";

const ALLOWED: Gateway[] = ["paystack", "flutterwave", "stripe"];

/**
 * Payment provider webhooks.
 *  1. read the raw body (signature is computed over the exact bytes)
 *  2. verify the HMAC signature server-side before touching any state
 *  3. de-duplicate by provider event id (idempotent replay)
 *  4. apply the billing change
 */
export async function POST(request: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  if (!ALLOWED.includes(gateway as Gateway)) return NextResponse.json({ ok: false, error: "Unknown gateway" }, { status: 404 });

  const rawBody = await request.text();
  const verification = verifyWebhook(gateway as Gateway, rawBody, request.headers);
  const db = await getDb();

  const eventId = verification.eventId || `unknown-${Date.now()}`;
  const duplicateOf = verification.valid
    ? await db.select({ id: webhookEvents.id }).from(webhookEvents).where(and(eq(webhookEvents.source, gateway), eq(webhookEvents.eventId, eventId))).limit(1)
    : [];

  await db
    .insert(webhookEvents)
    .values({
      source: gateway,
      eventId: `${eventId}${duplicateOf.length ? `-dup-${Date.now()}` : ""}`,
      signatureValid: verification.valid,
      status: verification.valid ? "received" : "failed",
      payload: safeParse(rawBody),
      error: verification.reason ?? null,
      processedAt: verification.valid ? new Date() : null,
    })
    .onConflictDoNothing();

  if (!verification.valid) {
    console.warn(`[mervo] rejected ${gateway} webhook: ${verification.reason}`);
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }
  if (duplicateOf.length) return NextResponse.json({ ok: true, duplicate: true });

  const applied = await applyBillingEvent(db, {
    gateway,
    eventId,
    type: verification.type ?? "unknown",
    tenantId: verification.tenantId,
    planCode: verification.planCode,
    amount: verification.amount,
    payload: safeParse(rawBody),
  });

  return NextResponse.json({ ok: true, ...applied });
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw: raw.slice(0, 2000) };
  }
}
