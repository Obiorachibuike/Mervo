import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { seedDatabase } from "@/server/db/seed";
import { branchIdOf, tenantIdsOf } from "./fixtures";

let ready: Promise<Db> | null = null;

/** Boots an isolated embedded-Postgres database and seeds it once per test file. */
export async function testDb(): Promise<Db> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (process.env.TEST_SEED === "1") await seedDatabase(db);
      return db;
    })();
  }
  return ready;
}

export async function resetTenantTables(db: Db) {
  await db.execute(sql`select 1`);
}

export { branchIdOf, tenantIdsOf };
