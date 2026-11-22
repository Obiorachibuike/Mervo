import { hmacHex, safeEqual } from "@/server/lib/crypto";

export type Gateway = "paystack" | "flutterwave" | "stripe" | "manual";

export type WebhookVerification = {
  valid: boolean;
  eventId: string | null;
  type: string | null;
  tenantId: string | null;
  planCode: string | null;
  amount: string;
  reference: string | null;
  reason?: string;
};

/**
 * Server-side webhook verification. A payload is never trusted before the
 * signature has been validated with the configured secret.
 */
export function verifyWebhook(source: Gateway, rawBody: string, headers: Headers): WebhookVerification {
  const parsed = safeParse(rawBody);
  const base: WebhookVerification = {
    valid: false,
    eventId: null,
    type: null,
    tenantId: null,
    planCode: null,
    amount: "0.00",
    reference: null,
  };

  try {
    if (source === "paystack") {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) return { ...base, reason: "PAYSTACK_SECRET_KEY is not configured" };
      const signature = headers.get("x-paystack-signature") ?? "";
      const expected = hmacHex(secret, rawBody, "sha512");
      const valid = safeEqual(signature, expected);
      const event = parsed?.event as string | undefined;
      const data = (parsed?.data ?? {}) as Record<string, unknown>;
      const metadata = (data.metadata ?? {}) as Record<string, unknown>;
      return {
        ...base,
        valid,
        eventId: String(data.id ?? parsed?.event ?? ""),
        type: event ?? null,
        tenantId: (metadata.tenantId as string) ?? null,
        planCode: (metadata.planCode as string) ?? null,
        amount: data.amount ? (Number(data.amount) / 100).toFixed(2) : "0.00",
        reference: (data.reference as string) ?? null,
        reason: valid ? undefined : "Invalid Paystack signature",
      };
    }

    if (source === "flutterwave") {
      const hash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
      if (!hash) return { ...base, reason: "FLUTTERWAVE_WEBHOOK_HASH is not configured" };
      const provided = headers.get("verif-hash") ?? "";
      const valid = safeEqual(provided, hash);
      const data = (parsed?.data ?? {}) as Record<string, unknown>;
      const meta = (parsed?.meta_data ?? {}) as Record<string, unknown>;
      return {
        ...base,
        valid,
        eventId: String(data.id ?? ""),
        type: String(parsed?.event ?? parsed?.["event.type"] ?? ""),
        tenantId: (meta.tenantId as string) ?? null,
        planCode: (meta.planCode as string) ?? null,
        amount: data.amount ? String(data.amount) : "0.00",
        reference: (data.tx_ref as string) ?? null,
        reason: valid ? undefined : "Invalid Flutterwave verification hash",
      };
    }

    if (source === "stripe") {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return { ...base, reason: "STRIPE_WEBHOOK_SECRET is not configured" };
      const header = headers.get("stripe-signature") ?? "";
      const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
      const timestamp = parts.t;
      const provided = parts.v1;
      if (!timestamp || !provided) return { ...base, reason: "Malformed Stripe signature header" };
      const expected = hmacHex(secret, `${timestamp}.${rawBody}`, "sha256");
      const valid = safeEqual(provided, expected);
      const obj = ((parsed?.data as Record<string, unknown>)?.object ?? {}) as Record<string, unknown>;
      return {
        ...base,
        valid,
        eventId: String(parsed?.id ?? ""),
        type: String(parsed?.type ?? ""),
        tenantId: ((obj.metadata as Record<string, unknown>)?.tenantId as string) ?? null,
        planCode: ((obj.metadata as Record<string, unknown>)?.planCode as string) ?? null,
        amount: obj.amount_total ? (Number(obj.amount_total) / 100).toFixed(2) : "0.00",
        reference: (obj.id as string) ?? null,
        reason: valid ? undefined : "Invalid Stripe signature",
      };
    }
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : "verification failed" };
  }
  return { ...base, reason: "Unknown gateway" };
}

function safeParse(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function gatewayConfigured(gateway: Gateway): boolean {
  if (gateway === "paystack") return Boolean(process.env.PAYSTACK_SECRET_KEY);
  if (gateway === "flutterwave") return Boolean(process.env.FLUTTERWAVE_SECRET_KEY && process.env.FLUTTERWAVE_WEBHOOK_HASH);
  if (gateway === "stripe") return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  return true;
}

export function publicPaymentConfig() {
  return {
    paystack: {
      configured: Boolean(process.env.PAYSTACK_SECRET_KEY),
      publicKey: process.env.PAYSTACK_PUBLIC_KEY ? "configured" : null,
    },
    flutterwave: { configured: gatewayConfigured("flutterwave") },
    stripe: { configured: gatewayConfigured("stripe") },
    cash: { configured: true },
    transfer: { configured: true },
  };
}
