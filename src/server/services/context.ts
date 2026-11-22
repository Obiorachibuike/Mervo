import type { Db, DbLike } from "@/server/db";

/** Everything a domain service needs. Built from the session in the app layer. */
export type ServiceCtx = {
  db: Db;
  tenantId: string;
  userId: string;
  permissions: string[];
  branchId?: string | null;
  currency?: string;
  isSuperAdmin?: boolean;
};

export type ServiceInput = Omit<ServiceCtx, "db"> & { db?: Db };
export type { DbLike };
