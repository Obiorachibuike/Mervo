/* CLI: npm run db:migrate — applies drizzle/*.sql in order (idempotent). */
import { runMigrations } from "./index";

runMigrations()
  .then(({ kind, applied }) => {
    console.log(`MERVO migrations — driver: ${kind}`);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "no migrations applied");
    process.exit(0);
  })
  .catch((err) => {
    console.error("migration failed", err);
    process.exit(1);
  });
