import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { MapPin, Phone, ShoppingBag } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, businesses, categories, products, storefronts, tenants } from "@/server/db/schema";
import { stockFor } from "@/server/services/inventory";
import { Storefront } from "@/components/store/storefront";
import { MervoLogo } from "@/components/brand";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function loadStore(slug: string) {
  const db = await getDb();
  const [row] = await db
    .select({ storefront: storefronts, business: businesses, tenant: tenants })
    .from(storefronts)
    .innerJoin(businesses, eq(businesses.tenantId, storefronts.tenantId))
    .innerJoin(tenants, eq(tenants.id, storefronts.tenantId))
    .where(eq(storefronts.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await loadStore(slug);
  if (!store) return { title: "Store not found" };
  return {
    title: store.storefront.headline ?? store.business.name,
    description: store.storefront.about ?? `Shop online at ${store.business.name} — powered by MERVO.`,
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await loadStore(slug);
  if (!store) notFound();
  const db = await getDb();
  const [branch] = await db.select().from(branches).where(eq(branches.tenantId, store.tenant.id)).limit(1);
  const stock = branch ? await stockFor(db, store.tenant.id, branch.id) : new Map<string, string>();
  const rows = await db
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.tenantId, store.tenant.id), eq(products.isActive, true)))
    .orderBy(asc(products.name));

  const catalogue = rows.map(({ product, categoryName }) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    categoryName,
    description: product.description,
    stock: Number(stock.get(product.id) ?? "0"),
  }));

  const currency = store.storefront.currency ?? store.business.currency;

  return (
    <div className="min-h-screen bg-[#F6F8F7] dark:bg-charcoal">
      <header className="border-b border-black/5 bg-white dark:border-white/10 dark:bg-[#141B21]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[15px] font-semibold tracking-tight">{store.business.name}</p>
            <p className="text-[10.5px] uppercase tracking-[0.16em] muted">Online store</p>
          </div>
          <div className="hidden items-center gap-3 text-[11px] sm:flex muted">
            {store.business.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3" />{store.business.phone}</span> : null}
            {store.business.city ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{store.business.city}</span> : null}
          </div>
          <MervoLogo className="scale-90" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <section className="rounded-3xl bg-charcoal px-6 py-8 text-white sm:px-8">
          <h1 className="max-w-2xl text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
            {store.storefront.headline ?? `Order from ${store.business.name}`}
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-white/65">
            {store.storefront.about ?? "Same-day delivery. Pay online or on delivery — every order is confirmed by the store."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-white/60">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1"><ShoppingBag className="size-3" /> {catalogue.length} products</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">Delivery {formatCurrency(store.storefront.deliveryFee, currency)}</span>
            {!store.storefront.isPublished ? <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-amber-200">Preview — not published</span> : null}
          </div>
        </section>

        <section className="mt-6">
          <Storefront
            slug={slug}
            currency={currency}
            deliveryFee={store.storefront.deliveryFee}
            products={catalogue}
            published={store.storefront.isPublished && store.tenant.status !== "suspended"}
          />
        </section>
      </main>

      <footer className="border-t border-black/5 py-6 text-center text-[11px] muted">
        <p>{store.business.name} · {store.business.address ?? "Nigeria"}</p>
        <p className="mt-1">Storefront powered by <span className="font-semibold tracking-wide">MERVO</span></p>
      </footer>
    </div>
  );
}
