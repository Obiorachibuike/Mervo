import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { Barcode, Boxes, PackagePlus, Pencil, Tag } from "lucide-react";
import { getDb } from "@/server/db";
import { branches, businesses, categories, products, suppliers } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, PageHeader } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/empty";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { createCategoryAction, createProductAction, updateProductAction } from "@/server/actions/catalog";
import { formatCurrency, formatNumber } from "@/lib/utils";


export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const currency = auth.tenant?.currency ?? "NGN";

  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const branchRows = await db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId));
  const categoryRows = await db.select().from(categories).where(eq(categories.tenantId, auth.tenantId)).orderBy(asc(categories.name));
  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, auth.tenantId)).orderBy(asc(suppliers.name));

  const conditions = [eq(products.tenantId, auth.tenantId)];
  if (params.q) conditions.push(sql`(lower(${products.name}) like ${`%${params.q.toLowerCase()}%`} or ${products.sku} ilike ${`%${params.q}%`})`);
  if (params.category && params.category !== "all") conditions.push(eq(products.categoryId, params.category));

  const rows = await db
    .select({
      product: products,
      categoryName: categories.name,
      supplierName: suppliers.name,
      stock: sql<string>`coalesce((select sum(sl.quantity) from stock_levels sl where sl.product_id = ${products.id} and sl.tenant_id = ${products.tenantId}), 0)::text`,
      variantCount: sql<number>`(select count(*)::int from product_variants pv where pv.product_id = ${products.id})`,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(and(...conditions))
    .orderBy(asc(products.name))
    .limit(300);

  const editing = params.edit ? rows.find((r) => r.product.id === params.edit)?.product : undefined;
  const totalValue = rows.reduce((sum, r) => sum + Number(r.stock) * Number(r.product.costPrice), 0);
  const lowCount = rows.filter((r) => Number(r.stock) <= Number(r.product.reorderPoint)).length;

  return (
    <>
      <Topbar title="Products" subtitle={`${rows.length} items in the catalogue · ${categoryRows.length} categories`} />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Catalogue" value={formatNumber(rows.length)} hint={`${rows.filter((r) => r.product.trackStock).length} stock-tracked`} icon={<Boxes className="size-4" />} />
          <StatCard label="Stock value" value={formatCurrency(totalValue.toFixed(2), currency)} hint="At weighted average cost" tone="positive" />
          <StatCard label="Low stock" value={formatNumber(lowCount)} hint="At or below reorder point" tone={lowCount ? "warning" : "default"} />
          <StatCard label="Categories" value={formatNumber(categoryRows.length)} hint="Used for POS filtering" icon={<Tag className="size-4" />} />
        </div>

        <Disclosure title="Add a product" description="Create a catalogue item with pricing, tax and opening stock." cta="New product" defaultOpen={params.new === "1" || rows.length === 0}>
          <ActionForm action={createProductAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" successMessage="Product added">
            <Field label="Name *"><Input name="name" required placeholder="Coca-Cola 50cl" /></Field>
            <Field label="SKU *"><Input name="sku" required placeholder="COKE-50" /></Field>
            <Field label="Barcode"><Input name="barcode" placeholder="5449000000996" /></Field>
            <Field label="Category">
              <Select name="categoryId" defaultValue="">
                <option value="">Uncategorised</option>
                {categoryRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Supplier">
              <Select name="supplierId" defaultValue="">
                <option value="">None</option>
                {supplierRows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Unit"><Input name="unit" defaultValue="pcs" /></Field>
            <Field label="Selling price *"><Input name="price" type="number" step="0.01" min="0" required defaultValue="0" /></Field>
            <Field label="Cost price"><Input name="costPrice" type="number" step="0.01" min="0" defaultValue="0" /></Field>
            <Field label="Tax rate %"><Input name="taxRate" type="number" step="0.01" min="0" max="100" defaultValue={String(business?.taxRate ?? 0)} /></Field>
            <Field label="Reorder point"><Input name="reorderPoint" type="number" step="0.001" min="0" defaultValue="5" /></Field>
            <Field label="Reorder quantity"><Input name="reorderQty" type="number" step="0.001" min="0" defaultValue="20" /></Field>
            <Field label="Opening stock">
              <div className="flex gap-2">
                <Input name="openingStock" type="number" step="0.001" min="0" defaultValue="0" />
                <Select name="branchId" defaultValue={branchRows[0]?.id ?? ""}>
                  {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </div>
            </Field>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" name="trackStock" defaultChecked className="size-4 rounded border-[var(--border)]" /> Track stock levels
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" name="isMenuItem" className="size-4 rounded border-[var(--border)]" /> Restaurant menu item
            </label>
            <div className="flex items-end"><SubmitButton>Add product</SubmitButton></div>
          </ActionForm>
        </Disclosure>

        <Disclosure title="Manage categories" description="Group products for faster POS navigation and cleaner reports." cta="Categories">
          <ActionForm action={createCategoryAction} className="flex flex-wrap items-end gap-2">
            <Field label="New category" className="min-w-[220px]"><Input name="name" placeholder="Beverages" required /></Field>
            <SubmitButton variant="outline">Add category</SubmitButton>
          </ActionForm>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categoryRows.map((c) => <Badge key={c.id} tone="neutral">{c.name}</Badge>)}
            {categoryRows.length === 0 ? <span className="text-[11.5px] muted">No categories yet.</span> : null}
          </div>
        </Disclosure>

        {editing ? (
          <Card className="p-4">
            <PageHeader title={`Edit ${editing.name}`} description="Pricing changes apply to new sales only — historic receipts stay immutable." />
            <ActionForm action={updateProductAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="sku" value={editing.sku} />
              <Field label="Name"><Input name="name" defaultValue={editing.name} required /></Field>
              <Field label="Barcode"><Input name="barcode" defaultValue={editing.barcode ?? ""} /></Field>
              <Field label="Selling price"><Input name="price" type="number" step="0.01" min="0" defaultValue={editing.price} /></Field>
              <Field label="Cost price"><Input name="costPrice" type="number" step="0.01" min="0" defaultValue={editing.costPrice} /></Field>
              <Field label="Tax rate %"><Input name="taxRate" type="number" step="0.01" min="0" max="100" defaultValue={editing.taxRate} /></Field>
              <Field label="Reorder point"><Input name="reorderPoint" type="number" step="0.001" min="0" defaultValue={editing.reorderPoint} /></Field>
              <Field label="Reorder quantity"><Input name="reorderQty" type="number" step="0.001" min="0" defaultValue={editing.reorderQty} /></Field>
              <Field label="Status">
                <Select name="isActive" defaultValue={editing.isActive ? "true" : "false"}>
                  <option value="true">Active — sellable</option>
                  <option value="false">Archived</option>
                </Select>
              </Field>
              <div className="flex items-end gap-2">
                <SubmitButton>Save changes</SubmitButton>
                <Button type="button" variant="ghost" size="md" className="hidden" />
              </div>
            </ActionForm>
          </Card>
        ) : null}

        <Card className="p-4">
          <form className="flex flex-wrap items-end gap-2" method="get">
            <Field label="Search" className="min-w-[200px] flex-1"><Input name="q" defaultValue={params.q ?? ""} placeholder="Name or SKU" /></Field>
            <Field label="Category">
              <Select name="category" defaultValue={params.category ?? "all"}>
                <option value="all">All categories</option>
                {categoryRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Button type="submit">Filter</Button>
          </form>
        </Card>

        {rows.length === 0 ? (
          <EmptyState title="No products found" description="Adjust your filters or add a new product above." icon={<PackagePlus className="size-5" />} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>SKU / Barcode</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Cost</Th>
                  <Th className="text-right">Price</Th>
                  <Th className="text-right">Stock</Th>
                  <Th className="text-right">Margin</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, categoryName, stock, variantCount }) => {
                  const margin = Number(product.price) > 0 ? ((Number(product.price) - Number(product.costPrice)) / Number(product.price)) * 100 : 0;
                  const qty = Number(stock);
                  const isLow = product.trackStock && qty <= Number(product.reorderPoint);
                  return (
                    <Tr key={product.id}>
                      <Td>
                        <span className="text-[12.5px] font-medium">{product.name}</span>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {!product.isActive ? <Badge tone="danger">Archived</Badge> : null}
                          {product.isMenuItem ? <Badge tone="neon">Menu</Badge> : null}
                          {variantCount > 0 ? <Badge tone="info">{variantCount} variants</Badge> : null}
                        </div>
                      </Td>
                      <Td className="font-mono text-[11px] muted">
                        {product.sku}
                        {product.barcode ? <p className="inline-flex items-center gap-1"><Barcode className="size-3" />{product.barcode}</p> : null}
                      </Td>
                      <Td className="text-[11.5px] muted">{categoryName ?? "—"}</Td>
                      <Td className="text-right text-[11.5px] tabular-nums muted">{formatCurrency(product.costPrice, currency)}</Td>
                      <Td className="text-right text-[12px] font-medium tabular-nums">{formatCurrency(product.price, currency)}</Td>
                      <Td className="text-right">
                        {product.trackStock ? (
                          <span className={`text-[12px] font-medium tabular-nums ${isLow ? "text-amber-600" : ""}`}>{formatNumber(Number(stock))}</span>
                        ) : (
                          <span className="text-[11px] muted">Service</span>
                        )}
                      </Td>
                      <Td className="text-right text-[11.5px] tabular-nums text-brand">{margin.toFixed(0)}%</Td>
                      <Td className="text-right">
                        <Link href={`/products?edit=${product.id}${params.q ? `&q=${params.q}` : ""}`} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-charcoal/60 hover:text-brand">
                          <Pencil className="size-3.5" /> Edit
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </PageBody>
    </>
  );
}
