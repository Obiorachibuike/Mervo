/**
 * Test harness: every vitest process gets its own embedded PostgreSQL instance
 * (real SQL, real transactions, real constraints) — no mocks of the database.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { branches, categories, customers, memberships, products, roles, users } from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import { hashPassword } from "@/server/lib/crypto";
import { provisionBusiness, getOrCreateRole } from "@/server/services/tenants";
import { applyStockMovement } from "@/server/services/inventory";

process.env.PGLITE_DIR = process.env.PGLITE_DIR ?? `/tmp/mervo-vitest-${process.pid}-${Date.now()}`;
process.env.AUTO_MIGRATE = "1";

let booted: Promise<void> | null = null;

export async function boot(): Promise<Db> {
  const db = await getDb();
  if (!booted) {
    booted = (async () => {
      await seedDatabase(db, { withDemo: false });
    })();
  }
  await booted;
  return db;
}

export type Workspace = {
  db: Db;
  tenantId: string;
  branchId: string;
  branch2Id: string;
  ownerId: string;
  ownerEmail: string;
  productIds: string[];
  productId: string;
  customerId: string;
  ctx: { db: Db; tenantId: string; userId: string; permissions: string[] };
};

export async function createWorkspace(db: Db, label = "Test Business", opts: { openingStock?: number } = {}): Promise<Workspace> {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${randomUUID().slice(0, 8)}@example.com`;
  const [owner] = await db
    .insert(users)
    .values({ email, name: `${label} Owner`, passwordHash: await hashPassword("TestOwner#2025"), emailVerifiedAt: new Date() })
    .returning({ id: users.id });

  const provisioned = await provisionBusiness(db, { ownerUserId: owner!.id, businessName: label, planCode: "growth", withRestaurant: false });
  const [branch2] = await db
    .insert(branches)
    .values({ tenantId: provisioned.tenantId, name: `${label} — Second`, code: "SECOND" })
    .returning({ id: branches.id });

  const [category] = await db.insert(categories).values({ tenantId: provisioned.tenantId, name: "General" }).returning({ id: categories.id });

  const productSeeds = [
    { name: "Test Rice", sku: `RICE-${randomUUID().slice(0, 6)}`, price: "1000.00", cost: "700.00" },
    { name: "Test Oil", sku: `OIL-${randomUUID().slice(0, 6)}`, price: "2500.00", cost: "1800.00" },
    { name: "Test Soap", sku: `SOAP-${randomUUID().slice(0, 6)}`, price: "500.00", cost: "300.00" },
  ];
  const productRows = await db
    .insert(products)
    .values(
      productSeeds.map((p) => ({
        tenantId: provisioned.tenantId,
        categoryId: category!.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        costPrice: p.cost,
        taxRate: "7.5",
        reorderPoint: "5",
        reorderQty: "20",
      })),
    )
    .returning({ id: products.id });

  const stock = String(opts.openingStock ?? 50);
  for (const product of productRows) {
    if (Number(stock) <= 0) continue;
    await applyStockMovement(db, {
      tenantId: provisioned.tenantId,
      branchId: provisioned.branchId,
      productId: product.id,
      type: "opening",
      quantityDelta: `${stock}.000`,
      unitCost: "700.00",
      reason: "Opening stock",
      createdBy: owner!.id,
    });
  }

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: provisioned.tenantId, name: "Test Customer", phone: "+2348000000000", creditLimit: "100000" })
    .returning({ id: customers.id });

  return {
    db,
    tenantId: provisioned.tenantId,
    branchId: provisioned.branchId,
    branch2Id: branch2!.id,
    ownerId: owner!.id,
    ownerEmail: email,
    productIds: productRows.map((p) => p.id),
    productId: productRows[0]!.id,
    customerId: customer!.id,
    ctx: { db, tenantId: provisioned.tenantId, userId: owner!.id, permissions: ["*"] },
  };
}

export async function addMember(db: Db, tenantId: string, roleKey: string, email?: string) {
  const address = email ?? `${roleKey}-${randomUUID().slice(0, 8)}@example.com`;
  const [user] = await db
    .insert(users)
    .values({ email: address, name: roleKey, passwordHash: await hashPassword("StaffMember#2025"), emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  const roleId = await getOrCreateRole(db, tenantId, roleKey);
  await db.insert(memberships).values({ tenantId, userId: user!.id, roleId, status: "active" });
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  return { userId: user!.id, email: address, permissions: role!.permissions };
}

export async function stockOf(db: Db, tenantId: string, branchId: string, productId: string) {
  const rows = await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    `select quantity::text from stock_levels where tenant_id = '${tenantId}' and branch_id = '${branchId}' and product_id = '${productId}' and variant_id is null` as any,
  );
  const list = (rows as unknown as { rows?: { quantity: string }[] }).rows ?? [];
  return list[0]?.quantity ?? "0";
}

export { and, eq };
