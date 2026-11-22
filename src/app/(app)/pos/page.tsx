import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { branches, businesses, categories, customers, products } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { stockFor } from "@/server/services/inventory";
import { PosTerminal, type PosCustomer, type PosProduct } from "@/components/pos/pos-terminal";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/link-button";
import { PageBody } from "@/components/ui/page";
import { PagePermission } from "@/components/shell/permission-gate";

export const metadata: Metadata = { title: "Point of sale" };
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, auth.tenantId), auth.branchId ? eq(branches.id, auth.branchId) : eq(branches.isDefault, true)))
    .limit(1);
  const activeBranch = branch ?? (await db.select().from(branches).where(eq(branches.tenantId, auth.tenantId)).limit(1))[0];
  if (!activeBranch) {
    return (
      <>
        <Topbar title="Point of sale" subtitle="Sell in seconds — search, scan, take payment." />
        <PageBody>
          <EmptyState title="No branch configured" description="Create a branch in Settings before opening the terminal." action={<LinkButton href="/settings/branches" size="sm">Create a branch</LinkButton>} />
        </PageBody>
      </>
    );
  }

  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const stock = await stockFor(db, auth.tenantId, activeBranch.id);
  const rows = await db
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.tenantId, auth.tenantId), eq(products.isActive, true)))
    .orderBy(asc(products.name));

  const catalogue: PosProduct[] = rows.map(({ product, categoryName }) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    price: product.price,
    taxRate: product.taxRate,
    categoryName,
    stock: stock.get(product.id) ?? "0.000",
  }));

  const customerRows = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, balanceOwed: customers.balanceOwed, creditLimit: customers.creditLimit })
    .from(customers)
    .where(eq(customers.tenantId, auth.tenantId))
    .orderBy(asc(customers.name))
    .limit(500);
  const customersForPos: PosCustomer[] = customerRows;

  if (!catalogue.length) {
    return (
      <>
        <Topbar title="Point of sale" subtitle="Sell in seconds — search, scan, take payment." />
        <PageBody>
          <EmptyState title="No products yet" description="Add your first product to start selling at the terminal." action={<LinkButton href="/products" size="sm">Add a product</LinkButton>} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <Topbar title="Point of sale" subtitle={`${activeBranch.name} · ${catalogue.length} products in catalogue`} />
      <PageBody>
        <PagePermission permission="sales.create">
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <PosTerminal
                products={catalogue}
                customers={customersForPos}
                currency={business?.currency ?? "NGN"}
                branchId={activeBranch.id}
                branchName={activeBranch.name}
                cashierName={auth.user.name}
                taxRate={Number(business?.taxRate ?? 0)}
              />
            </CardContent>
          </Card>
        </PagePermission>
      </PageBody>
    </>
  );
}
