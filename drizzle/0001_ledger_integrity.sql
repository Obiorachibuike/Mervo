-- MERVO — ledger integrity, tenant-safety indexes and immutability guards.

-- A stock level row is unique per (branch, product) when no variant is involved.
CREATE UNIQUE INDEX IF NOT EXISTS stock_levels_no_variant_uq
  ON "stock_levels" ("branch_id", "product_id") WHERE "variant_id" IS NULL;
--> statement-breakpoint

-- Hot paths: POS lookups, dashboards, AI aggregates.
CREATE INDEX IF NOT EXISTS sales_tenant_status_created_idx ON "sales" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS sale_items_tenant_sale_idx ON "sale_items" ("tenant_id", "sale_id");
CREATE INDEX IF NOT EXISTS journal_lines_tenant_entry_idx ON "journal_lines" ("tenant_id", "entry_id");
CREATE INDEX IF NOT EXISTS customers_tenant_last_purchase_idx ON "customers" ("tenant_id", "last_purchase_at");
CREATE INDEX IF NOT EXISTS stock_movements_branch_idx ON "stock_movements" ("tenant_id", "branch_id", "created_at");
--> statement-breakpoint

-- Immutable ledgers: stock movements, journal entries and audit logs are append-only.
CREATE OR REPLACE FUNCTION mervo_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MERVO ledgers are append-only: % is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS stock_movements_immutable ON "stock_movements";
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION mervo_block_mutation();
--> statement-breakpoint

DROP TRIGGER IF EXISTS journal_entries_immutable ON "journal_entries";
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION mervo_block_mutation();
--> statement-breakpoint

DROP TRIGGER IF EXISTS journal_lines_immutable ON "journal_lines";
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION mervo_block_mutation();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_immutable ON "audit_logs";
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION mervo_block_mutation();
--> statement-breakpoint

-- Defence in depth: a balanced-journal invariant enforced by the database itself.
CREATE OR REPLACE FUNCTION mervo_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  d numeric;
  c numeric;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0) INTO d, c
  FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Unbalanced journal entry %: debits % credits %', NEW.entry_id, d, c;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
