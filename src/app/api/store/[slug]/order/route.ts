import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { branches, products, storefronts, tenants, customers } from "@/server/db/schema";
import { handleApiError, jsonError, jsonOk, parseJson, getClientIp } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { createSale } from "@/server/services/sales";
import { createKitchenOrder } from "@/server/services/restaurant";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const orderSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.string().regex(/^\d+(\.\d{1,3})?$/) })).min(1).max(50),
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  email: z.string().email().optional().nullable(),
  address: z.string().trim().min(5).max(400),
  note: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(["paystack", "cash_on_delivery", "transfer"]).default("cash_on_delivery"),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

/** Public storefront checkout. Creates a real sale that shares tenant inventory. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const limit = await rateLimit({ bucket: "storefront-order", identifier: `${slug}:${getClientIp(request)}`, limit: 10, windowSeconds: 300 });
    if (!limit.allowed) return jsonError("Too many orders from this device. Please try again shortly.", 429);

    const body = orderSchema.safeParse(await parseJson<unknown>(request));
    if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Invalid order", 422);

    const db = await getDb();
    const [store] = await db
      .select({ storefront: storefronts, tenant: tenants })
      .from(storefronts)
      .innerJoin(tenants, eq(tenants.id, storefronts.tenantId))
      .where(and(eq(storefronts.slug, slug), eq(storefronts.isPublished, true)))
      .limit(1);
    if (!store) return jsonError("Storefront not found", 404);
    if (store.tenant.status === "suspended") return jsonError("This store is temporarily unavailable", 503);

    const [branch] = await db.select().from(branches).where(eq(branches.tenantId, store.tenant.id)).limit(1);
    if (!branch) return jsonError("Store is not configured for orders", 503);

    const productRows = await db.select().from(products).where(eq(products.tenantId, store.tenant.id));
    const byId = new Map(productRows.map((p) => [p.id, p]));
    for (const item of body.data.items) if (!byId.has(item.productId)) return jsonError("One of the products is no longer available", 422);

    // reuse a customer record when the phone number matches (CRM continuity)
    const [existingCustomer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, store.tenant.id), eq(customers.phone, body.data.phone)))
      .limit(1);
    let customerId = existingCustomer?.id ?? null;
    if (!customerId) {
      const [created] = await db
        .insert(customers)
        .values({ tenantId: store.tenant.id, name: body.data.customerName, phone: body.data.phone, email: body.data.email ?? null, address: body.data.address, marketingConsent: false })
        .returning({ id: customers.id });
      customerId = created!.id;
    }

    const owner = await db.select({ id: tenants.ownerUserId }).from(tenants).where(eq(tenants.id, store.tenant.id)).limit(1);
    const sale = await createSale(
      { db, tenantId: store.tenant.id, userId: owner[0]?.id ?? store.tenant.id, permissions: ["*"] },
      {
        branchId: branch.id,
        customerId,
        items: body.data.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        // nothing is collected at checkout: the sale stays open until delivery,
        // a transfer is confirmed, or the Paystack webhook settles it
        payments: [],
        idempotencyKey: body.data.idempotencyKey ?? `store-${randomUUID()}`,
        source: "storefront",
        enforceCreditLimit: false,
        notes: `Online order · ${body.data.customerName} · ${body.data.phone} · ${body.data.address}${body.data.note ? ` · ${body.data.note}` : ""}`,
      },
    );

    const menuStation = body.data.items
      .map((i) => byId.get(i.productId))
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.isMenuItem))
      .map((p) => (p.name.includes("Chapman") || p.name.includes("Beer") ? "bar" : "kitchen"));
    if (menuStation.length) {
      await createKitchenOrder(db, {
        tenantId: store.tenant.id,
        branchId: branch.id,
        saleId: sale.saleId,
        station: menuStation[0]!,
        items: body.data.items.map((i) => ({ name: byId.get(i.productId)!.name, quantity: i.quantity })),
        notes: `Online order for ${body.data.customerName}`,
      }).catch(() => undefined);
    }

    return jsonOk(
      {
        number: sale.number,
        saleId: sale.saleId,
        total: sale.total,
        paymentMethod: body.data.paymentMethod,
        message:
          body.data.paymentMethod === "cash_on_delivery"
            ? "Order placed. Pay on delivery."
            : "Order placed. Complete payment to confirm dispatch.",
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
