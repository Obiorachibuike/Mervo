import { and, eq, sql } from "drizzle-orm";
import {
  branches,
  businesses,
  categories,
  memberships,
  menus,
  plans,
  restaurantTables,
  restaurants,
  roles,
  storefronts,
  subscriptions,
  tenants,
  users,
} from "@/server/db/schema";
import type { Db, DbLike } from "@/server/db";
import { ROLE_DEFINITIONS } from "@/server/auth/permissions";
import { ensureChartOfAccounts } from "./finance";
import { slugify } from "@/server/lib/slug";

export async function ensureSystemRoles(db: DbLike): Promise<void> {
  for (const def of ROLE_DEFINITIONS) {
    if (def.key === "super_admin") continue;
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.key, def.key), sql`${roles.tenantId} is null`))
      .limit(1);
    if (existing) continue;
    await db.insert(roles).values({
      tenantId: null,
      key: def.key,
      name: def.name,
      description: def.description,
      permissions: def.permissions as string[],
      isSystem: true,
    });
  }
}

export async function getOrCreateRole(db: DbLike, tenantId: string, roleKey: string): Promise<string> {
  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)))
    .limit(1);
  if (existing) return existing.id;
  const def = ROLE_DEFINITIONS.find((r) => r.key === roleKey) ?? ROLE_DEFINITIONS.find((r) => r.key === "cashier")!;
  const [created] = await db
    .insert(roles)
    .values({ tenantId, key: def.key, name: def.name, description: def.description, permissions: def.permissions as string[], isSystem: true })
    .returning({ id: roles.id });
  return created!.id;
}

async function uniqueSlug(db: DbLike, base: string): Promise<string> {
  const slug = slugify(base) || "business";
  for (let i = 0; i < 40; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate)).limit(1);
    if (!row) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

export type ProvisionedBusiness = {
  tenantId: string;
  businessId: string;
  branchId: string;
  slug: string;
  planId: string;
  trialEndsAt: Date;
};

/**
 * Provisions a complete, isolated business workspace:
 * tenant → business profile → main branch → chart of accounts → storefront →
 * subscription (trial) → owner membership.
 */
export async function provisionBusiness(
  db: Db,
  input: {
    ownerUserId: string;
    businessName: string;
    industry?: string;
    currency?: string;
    country?: string;
    planCode?: string;
    withRestaurant?: boolean;
    seedCatalogue?: boolean;
  },
): Promise<ProvisionedBusiness> {
  await ensureSystemRoles(db);
  const [plan] = await db.select().from(plans).where(eq(plans.code, input.planCode ?? "free")).limit(1);
  if (!plan) throw new Error("Subscription plans are not configured. Run `npm run db:seed` first.");
  const slug = await uniqueSlug(db, input.businessName);
  const trialEndsAt = new Date(Date.now() + plan.trialDays * 86400000);

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: input.businessName,
        slug,
        status: "trialing",
        currency: input.currency ?? "NGN",
        country: input.country ?? "NG",
        ownerUserId: input.ownerUserId,
        trialEndsAt,
        aiTokensLimit: plan.limits.aiTokens,
      })
      .returning({ id: tenants.id });

    const [business] = await tx
      .insert(businesses)
      .values({
        tenantId: tenant!.id,
        name: input.businessName,
        industry: input.industry ?? "retail",
        currency: input.currency ?? "NGN",
        country: input.country ?? "NG",
        taxRate: input.country === "NG" ? "7.5" : "0",
        receiptFooter: "Thank you for shopping with us. Powered by MERVO.",
      })
      .returning({ id: businesses.id });

    const [branch] = await tx
      .insert(branches)
      .values({
        tenantId: tenant!.id,
        name: `${input.businessName} — Main`,
        code: "MAIN",
        isDefault: true,
        type: input.withRestaurant ? "restaurant" : "store",
      })
      .returning({ id: branches.id });

    await ensureChartOfAccounts(tx, tenant!.id);

    await tx.insert(storefronts).values({ tenantId: tenant!.id, slug, headline: input.businessName, isPublished: false });

    await tx.insert(subscriptions).values({
      tenantId: tenant!.id,
      planId: plan.id,
      status: "trialing",
      interval: "monthly",
      gateway: "manual",
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
      seats: 1,
    });

    const ownerRoleId = await getOrCreateRole(tx, tenant!.id, "owner");
    await tx.insert(memberships).values({
      tenantId: tenant!.id,
      userId: input.ownerUserId,
      roleId: ownerRoleId,
      branchId: branch!.id,
      status: "active",
      title: "Owner",
    });
    await tx.update(users).set({ defaultTenantId: tenant!.id }).where(eq(users.id, input.ownerUserId));

    if (input.seedCatalogue) {
      const catRows = await tx
        .insert(categories)
        .values([
          { tenantId: tenant!.id, name: "General" },
          { tenantId: tenant!.id, name: "Beverages" },
          { tenantId: tenant!.id, name: "Snacks" },
        ])
        .returning({ id: categories.id });
      await tx.insert(storefronts).values({ tenantId: tenant!.id, slug: `${slug}-store`, headline: input.businessName, isPublished: true }).onConflictDoNothing();
      void catRows;
    }

    if (input.withRestaurant) {
      const [restaurant] = await tx
        .insert(restaurants)
        .values({ tenantId: tenant!.id, branchId: branch!.id, name: input.businessName, serviceChargeRate: "5" })
        .returning({ id: restaurants.id });
      await tx.insert(restaurantTables).values(
        Array.from({ length: 8 }, (_, i) => ({
          tenantId: tenant!.id,
          branchId: branch!.id,
          restaurantId: restaurant!.id,
          label: `T${i + 1}`,
          seats: i % 3 === 0 ? 2 : 4,
          area: i < 5 ? "main" : "terrace",
        })),
      );
      await tx.insert(menus).values({ tenantId: tenant!.id, branchId: branch!.id, name: "Main Menu" });
    }

    return {
      tenantId: tenant!.id,
      businessId: business!.id,
      branchId: branch!.id,
      slug,
      planId: plan.id,
      trialEndsAt,
    };
  });
}

export async function updateBusinessProfile(
  db: DbLike,
  tenantId: string,
  input: Partial<{
    name: string;
    legalName: string | null;
    industry: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    currency: string;
    taxRate: string;
    taxInclusive: boolean;
    receiptFooter: string | null;
  }>,
) {
  const [row] = await db
    .update(businesses)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(businesses.tenantId, tenantId))
    .returning();
  if (input.name) await db.update(tenants).set({ name: input.name, currency: input.currency ?? undefined, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return row;
}

export async function createBranch(db: DbLike, tenantId: string, input: { name: string; code: string; address?: string | null; phone?: string | null; type?: "store" | "restaurant" | "warehouse" | "hotel" }) {
  const [row] = await db
    .insert(branches)
    .values({ tenantId, name: input.name, code: input.code.toUpperCase(), address: input.address ?? null, phone: input.phone ?? null, type: input.type ?? "store" })
    .returning();
  return row!;
}

export async function inviteMember(
  db: DbLike,
  input: { tenantId: string; email: string; name: string; roleKey: string; branchId?: string | null },
) {
  const [existingUser] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  let userId = existingUser?.id;
  if (!userId) {
    const [created] = await db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash: null })
      .returning({ id: users.id });
    userId = created!.id;
  }
  const roleId = await getOrCreateRole(db, input.tenantId, input.roleKey);
  const [membership] = await db
    .insert(memberships)
    .values({ tenantId: input.tenantId, userId: userId!, roleId, branchId: input.branchId ?? null, status: "invited" })
    .onConflictDoNothing()
    .returning();
  return { userId: userId!, membershipId: membership?.id ?? null, existed: Boolean(existingUser) };
}

export async function listTeam(db: DbLike, tenantId: string) {
  return db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      status: memberships.status,
      title: memberships.title,
      roleKey: roles.key,
      roleName: roles.name,
      permissions: roles.permissions,
      branchId: memberships.branchId,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(eq(memberships.tenantId, tenantId));
}

export async function branchesFor(db: DbLike, tenantId: string) {
  return db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(branches.name);
}

export async function tenantUsage(db: DbLike, tenantId: string) {
  const [counts] = await db
    .select({
      branches: sql<number>`(select count(*)::int from ${branches} where ${branches.tenantId} = ${tenantId})`,
      users: sql<number>`(select count(*)::int from ${memberships} where ${memberships.tenantId} = ${tenantId})`,
      products: sql<number>`(select count(*)::int from ${categories} where false)`,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return counts ?? { branches: 0, users: 0, products: 0 };
}

export { plans, subscriptions };
