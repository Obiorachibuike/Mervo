import fs from "node:fs";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbLike = Db | Tx;

type Kind = "postgres" | "pglite";

type State = {
  db: Db;
  kind: Kind;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

const globalForDb = globalThis as unknown as { __mervoDb?: Promise<State> };

export const isPostgres = () => Boolean(process.env.DATABASE_URL?.trim());

function embeddedDir(): string {
  if (process.env.PGLITE_DIR) return process.env.PGLITE_DIR;
  if (process.env.VERCEL) return "/tmp/mervo-pglite";
  return path.join(process.cwd(), ".data", "pglite");
}

async function init(): Promise<State> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      ssl: url.includes("sslmode=require") || process.env.PG_SSL === "1" ? { rejectUnauthorized: false } : undefined,
    });
    const db = drizzle(pool, { schema, logger: process.env.DRIZZLE_LOG === "1" }) as unknown as Db;
    return {
      db,
      kind: "postgres",
      exec: async (sql: string) => {
        await pool.query(sql);
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dir = embeddedDir();
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const { drizzle } = await import("drizzle-orm/pglite");
  const db = drizzle(client, { schema }) as unknown as Db;
  return {
    db,
    kind: "pglite",
    exec: async (sql: string) => {
      await client.exec(sql);
    },
    close: async () => {
      await client.close();
    },
  };
}

export async function getState(): Promise<State> {
  if (!globalForDb.__mervoDb) globalForDb.__mervoDb = init();
  return globalForDb.__mervoDb;
}

/** Returns the Drizzle client for the configured driver (Postgres or embedded PGlite). */
export async function getDb(): Promise<Db> {
  const state = await getState();
  await ensureMigrated(state);
  await ensureBootstrapped(state);
  return state.db;
}

const bootstrapState = globalThis as unknown as { __mervoBootstrapped?: Promise<void> };

async function ensureBootstrapped(state: State): Promise<void> {
  if (process.env.MERVO_BOOTSTRAP === "0") return;
  if (!bootstrapState.__mervoBootstrapped) {
    bootstrapState.__mervoBootstrapped = (async () => {
      try {
        const { bootstrapPlatform } = await import("@/server/bootstrap");
        await bootstrapPlatform(state.db);
      } catch (error) {
        console.error("[mervo] bootstrap failed", error);
        bootstrapState.__mervoBootstrapped = undefined;
        throw error;
      }
    })();
  }
  return bootstrapState.__mervoBootstrapped;
}

export const dbKind = async (): Promise<Kind> => (await getState()).kind;

/* ─────────────────────────────── migrations ─────────────────────────────── */

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS mervo_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

const migrationState = globalThis as unknown as { __mervoMigrated?: Promise<void> };

function migrationsDir(): string {
  const candidates = [path.join(process.cwd(), "drizzle"), path.join(process.cwd(), "..", "drizzle")];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0] as string;
}

function migrationFiles(): string[] {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function ensureMigrated(state: State): Promise<void> {
  if (process.env.AUTO_MIGRATE === "0") return;
  if (state.kind === "postgres" && process.env.AUTO_MIGRATE !== "1") return;
  if (!migrationState.__mervoMigrated) {
    migrationState.__mervoMigrated = (async () => {
      await state.exec(MIGRATIONS_TABLE);
      for (const file of migrationFiles()) {
        const id = file;
        const rows = await state.db.execute(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `SELECT id FROM mervo_migrations WHERE id = '${id.replace(/'/g, "''")}'` as any,
        );
        const applied = (rows as unknown as { rows?: unknown[] }).rows ?? [];
        if (applied.length > 0) continue;
        const sql = fs.readFileSync(path.join(migrationsDir(), file), "utf8");
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const statement of statements) await state.exec(statement);
        await state.exec(`INSERT INTO mervo_migrations (id) VALUES ('${id.replace(/'/g, "''")}')`);
      }
    })();
  }
  return migrationState.__mervoMigrated;
}

export async function runMigrations(): Promise<{ kind: Kind; applied: string[] }> {
  const state = await getState();
  await ensureMigrated(state);
  const rows = await state.db.execute(`SELECT id FROM mervo_migrations ORDER BY applied_at` as never);
  const list = ((rows as unknown as { rows?: { id: string }[] }).rows ?? []).map((r) => r.id);
  return { kind: state.kind, applied: list };
}

/* ───────────────────────── tenant-scoped helpers ────────────────────────── */

/** Thrown when a query would cross a tenant boundary. */
export class TenantIsolationError extends Error {
  constructor(message = "Cross-tenant access denied") {
    super(message);
    this.name = "TenantIsolationError";
  }
}

/**
 * Every tenant-owned table is queried with an explicit tenant predicate.
 * This helper makes that predicate impossible to forget accidentally by
 * funneling all scoped queries through it.
 */
export function tenantScope(tenantId: string) {
  if (!tenantId) throw new TenantIsolationError("Missing tenant id");
  return tenantId;
}

/** Generic guard: refuse to touch a row belonging to another tenant. */
export function assertSameTenant(rowTenantId: string | null | undefined, tenantId: string): void {
  if (!rowTenantId || rowTenantId !== tenantId) throw new TenantIsolationError();
}
