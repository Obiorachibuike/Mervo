import { sql } from "drizzle-orm";
import { getDb, runMigrations } from "@/server/db";

async function main() {
  const r = await runMigrations();
  console.log("driver:", r.kind, "| applied:", r.applied.join(", ") || "none");
  const db = await getDb();
  const t = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema='public'`);
  console.log("public tables:", (t.rows[0] as { n: number }).n);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
