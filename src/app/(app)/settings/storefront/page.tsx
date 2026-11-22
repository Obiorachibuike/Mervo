import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ExternalLink, Store } from "lucide-react";
import { getDb } from "@/server/db";
import { businesses, products, storefronts } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { LinkButton } from "@/components/ui/link-button";
import { updateStorefrontAction } from "@/server/actions/team";
import { slugify } from "@/server/lib/slug";

export const metadata: Metadata = { title: "Storefront" };
export const dynamic = "force-dynamic";

export default async function StorefrontSettingsPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [store] = await db.select().from(storefronts).where(eq(storefronts.tenantId, auth.tenantId)).limit(1);
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const catalogue = await db
    .select({ id: products.id, name: products.name, price: products.price, isActive: products.isActive })
    .from(products)
    .where(and(eq(products.tenantId, auth.tenantId), eq(products.isActive, true)))
    .limit(6);

  const slug = store?.slug ?? slugify(business?.name ?? "store");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Status" value={store?.isPublished ? "Published" : "Draft"} hint={store ? `/store/${slug}` : "Not created yet"} icon={<Store className="size-4" />} />
        <StatCard label="Currency" value={store?.currency ?? business?.currency ?? "NGN"} hint="Inherited from business" />
        <StatCard label="Delivery fee" value={store?.deliveryFee ?? "0.00"} hint="Added at checkout" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle hint="Customers can order without an account">Your online store</SectionTitle>
          {store?.isPublished ? (
            <LinkButton href={`/store/${slug}`} variant="outline" size="sm" target="_blank">
              <ExternalLink className="size-3.5" /> Visit storefront
            </LinkButton>
          ) : null}
        </div>
        <ActionForm action={updateStorefrontAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Handle *"><Input name="slug" defaultValue={slug} required pattern="[a-z0-9-]{3,60}" /></Field>
          <Field label="Headline"><Input name="headline" defaultValue={store?.headline ?? `Shop ${business?.name ?? "with us"}`} /></Field>
          <Field label="About" className="sm:col-span-2"><Textarea name="about" rows={3} defaultValue={store?.about ?? ""} placeholder="Same-day delivery across Lagos. Fresh stock every morning." /></Field>
          <Field label="Delivery fee"><Input name="deliveryFee" type="number" step="0.01" min="0" defaultValue={store?.deliveryFee ?? "0"} /></Field>
          <label className="flex items-center gap-2 self-end text-[12px]">
            <input type="checkbox" name="isPublished" defaultChecked={store?.isPublished} className="size-4 rounded border-[var(--border)]" /> Publish storefront
          </label>
          <div className="sm:col-span-2"><SubmitButton>Save storefront</SubmitButton></div>
        </ActionForm>
      </Card>

      <Card className="p-4">
        <SectionTitle hint={`${catalogue.length} shown`}>Visible products</SectionTitle>
        <ul className="mt-3 divide-y divide-[var(--border)] text-[12px]">
          {catalogue.map((product) => (
            <li key={product.id} className="flex items-center justify-between py-1.5">
              <span>{product.name}</span>
              <Badge tone={product.isActive ? "success" : "neutral"}>{product.price}</Badge>
            </li>
          ))}
          {catalogue.length === 0 ? <li className="py-2 muted">Add active products to populate the storefront.</li> : null}
        </ul>
        <p className="mt-3 text-[11px] muted">
          Orders create real sales that share stock, ledger entries and CRM records with your POS. Payment can be collected online or on delivery.{" "}
          <Link href="/products" className="font-medium text-brand">Manage catalogue</Link>
        </p>
      </Card>
    </div>
  );
}
