import { and, eq } from "drizzle-orm";
import type { Db } from "@/server/db";
import { branches, tenants, users } from "@/server/db/schema";

export async function tenantIdsOf(db: Db) {
  return (await db.select({ id: tenants.id, name: tenants.name }).from(tenants)).map((t) => t.id);
}

export async function branchIdOf(db: Db, tenantId: string) {
  const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1);
  if (!branch) throw new Error("no branch");
  return branch.id;
}

export async function ownerId(db: Db) {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, "owner@mervo.app"));
  return owner!.id;
}

export async function tenantByName(db: Db, name: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.name, name)).limit(1);
  return tenant;
}

export async function branchByName(db: Db, tenantId: string, name: string) {
  const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.name, name))).limit(1);
  return branch;
}
