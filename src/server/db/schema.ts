/**
 * MERVO — database schema (PostgreSQL, Drizzle ORM)
 *
 * Conventions
 *  - UUID primary keys (gen_random_uuid)
 *  - every tenant-scoped table carries `tenant_id` and is always queried through
 *    the tenant-scoped service layer (see src/server/db/tenant.ts)
 *  - money is numeric(18,2) (decimal-safe, never float); quantities numeric(14,3)
 *  - timestamps are UTC (timestamptz)
 *  - sales / stock movements / journal entries are immutable ledgers
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").defaultNow().notNull();
const updatedAt = () => ts("updated_at").defaultNow().notNull();

/* ────────────────────────────── Tenancy ─────────────────────────────────── */

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").$type<"active" | "trialing" | "suspended" | "cancelled">().notNull().default("trialing"),
    currency: text("currency").notNull().default("NGN"),
    country: text("country").notNull().default("NG"),
    timezone: text("timezone").notNull().default("Africa/Lagos"),
    ownerUserId: uuid("owner_user_id"),
    trialEndsAt: ts("trial_ends_at"),
    aiTokensUsed: integer("ai_tokens_used").notNull().default(0),
    aiTokensLimit: integer("ai_tokens_limit").notNull().default(50_000),
    suspendedReason: text("suspended_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tenants_slug_uq").on(t.slug), index("tenants_status_idx").on(t.status)],
);

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    industry: text("industry").notNull().default("retail"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    country: text("country").notNull().default("NG"),
    currency: text("currency").notNull().default("NGN"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 3 }).notNull().default("7.5"),
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    receiptFooter: text("receipt_footer"),
    logoUrl: text("logo_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("businesses_tenant_uq").on(t.tenantId)],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address"),
    phone: text("phone"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    type: text("type").$type<"store" | "restaurant" | "warehouse" | "hotel">().notNull().default("store"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("branches_tenant_code_uq").on(t.tenantId, t.code),
    index("branches_tenant_idx").on(t.tenantId),
  ],
);

/* ─────────────────────── Users, roles, sessions ──────────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    phone: text("phone"),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    emailVerifiedAt: ts("email_verified_at"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    defaultTenantId: uuid("default_tenant_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_tenant_key_uq").on(t.tenantId, t.key)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    status: text("status").$type<"active" | "invited" | "disabled">().notNull().default("active"),
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    activeTenantId: uuid("active_tenant_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    revokedAt: ts("revoked_at"),
    lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"email" | "password_reset" | "invite">().notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("verification_token_uq").on(t.tokenHash), index("verification_user_idx").on(t.userId)],
);

/* ────────────────────────────── Catalogue ───────────────────────────────── */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    color: text("color"),
    createdAt: createdAt(),
  },
  (t) => [index("categories_tenant_idx").on(t.tenantId)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    balanceOwed: money("balance_owed").notNull().default("0"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("suppliers_tenant_idx").on(t.tenantId)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    brand: text("brand"),
    unit: text("unit").notNull().default("pcs"),
    costPrice: money("cost_price").notNull().default("0"),
    price: money("price").notNull().default("0"),
    wholesalePrice: money("wholesale_price"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    trackStock: boolean("track_stock").notNull().default(true),
    reorderPoint: qty("reorder_point").notNull().default("0"),
    reorderQty: qty("reorder_qty").notNull().default("0"),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").notNull().default(true),
    isMenuItem: boolean("is_menu_item").notNull().default(false),
    trackBatches: boolean("track_batches").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_tenant_sku_uq").on(t.tenantId, t.sku),
    index("products_tenant_idx").on(t.tenantId),
    index("products_barcode_idx").on(t.tenantId, t.barcode),
    index("products_name_idx").on(t.tenantId, t.name),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    priceOverride: money("price_override"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("variants_tenant_sku_uq").on(t.tenantId, t.sku)],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: qty("quantity").notNull().default("0"),
    avgCost: money("avg_cost").notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("stock_levels_scope_uq").on(t.branchId, t.productId, t.variantId),
    index("stock_levels_tenant_idx").on(t.tenantId),
  ],
);

/** Immutable stock movement ledger — appended only, never updated or deleted. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    type: text("type")
      .$type<"sale" | "refund" | "purchase" | "adjustment" | "transfer_out" | "transfer_in" | "opening" | "wastage">()
      .notNull(),
    quantityDelta: qty("quantity_delta").notNull(),
    unitCost: money("unit_cost").notNull().default("0"),
    balanceAfter: qty("balance_after").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reason: text("reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_movements_tenant_idx").on(t.tenantId, t.createdAt),
    index("stock_movements_product_idx").on(t.tenantId, t.productId),
    index("stock_movements_ref_idx").on(t.tenantId, t.referenceId),
  ],
);

export const stockTransfers = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fromBranchId: uuid("from_branch_id").notNull().references(() => branches.id),
  toBranchId: uuid("to_branch_id").notNull().references(() => branches.id),
  status: text("status").$type<"pending" | "in_transit" | "received" | "cancelled">().notNull().default("pending"),
  reference: text("reference").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  receivedAt: ts("received_at"),
  createdAt: createdAt(),
});

export const stockTransferItems = pgTable("stock_transfer_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  transferId: uuid("transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull(),
  variantId: uuid("variant_id"),
  quantity: qty("quantity").notNull(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  reference: text("reference").notNull(),
  status: text("status").$type<"draft" | "ordered" | "partial" | "received" | "cancelled">().notNull().default("draft"),
  subtotal: money("subtotal").notNull().default("0"),
  total: money("total").notNull().default("0"),
  amountPaid: money("amount_paid").notNull().default("0"),
  expectedAt: ts("expected_at"),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull(),
  variantId: uuid("variant_id"),
  quantity: qty("quantity").notNull(),
  unitCost: money("unit_cost").notNull(),
  receivedQty: qty("received_qty").notNull().default("0"),
});

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchNumber: text("batch_number").notNull(),
    quantity: qty("quantity").notNull().default("0"),
    unitCost: money("unit_cost").notNull().default("0"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [index("batches_expiry_idx").on(t.tenantId, t.expiresAt)],
);

/* ─────────────────────────────── Customers ──────────────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    creditLimit: money("credit_limit").notNull().default("0"),
    balanceOwed: money("balance_owed").notNull().default("0"),
    totalSpent: money("total_spent").notNull().default("0"),
    orderCount: integer("order_count").notNull().default(0),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    whatsappConsent: boolean("whatsapp_consent").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    segment: text("segment").$type<"new" | "active" | "loyal" | "at_risk" | "inactive">().notNull().default("new"),
    lastPurchaseAt: ts("last_purchase_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customers_tenant_idx").on(t.tenantId),
    index("customers_phone_idx").on(t.tenantId, t.phone),
    index("customers_email_idx").on(t.tenantId, t.email),
  ],
);

/* ───────────────────────────────── Sales ────────────────────────────────── */

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    number: text("number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    createdBy: uuid("created_by"),
    registerId: text("register_id"),
    status: text("status").$type<"draft" | "completed" | "voided" | "refunded" | "partially_refunded" | "suspended">().notNull().default("completed"),
    source: text("source").$type<"pos" | "storefront" | "offline_sync" | "restaurant">().notNull().default("pos"),
    subtotal: money("subtotal").notNull().default("0"),
    discountTotal: money("discount_total").notNull().default("0"),
    taxTotal: money("tax_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    costTotal: money("cost_total").notNull().default("0"),
    paidTotal: money("paid_total").notNull().default("0"),
    changeDue: money("change_due").notNull().default("0"),
    balanceDue: money("balance_due").notNull().default("0"),
    currency: text("currency").notNull().default("NGN"),
    paymentStatus: text("payment_status").$type<"unpaid" | "partial" | "paid" | "refunded">().notNull().default("paid"),
    fulfillmentStatus: text("fulfillment_status")
      .$type<"pending" | "packed" | "shipped" | "delivered" | "cancelled">()
      .notNull()
      .default("delivered"),
    deliveryAddress: text("delivery_address"),
    idempotencyKey: text("idempotency_key"),
    offlineCreatedAt: ts("offline_created_at"),
    notes: text("notes"),
    receiptEmail: text("receipt_email"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    uniqueIndex("sales_tenant_number_uq").on(t.tenantId, t.number),
    uniqueIndex("sales_tenant_idem_uq").on(t.tenantId, t.idempotencyKey),
    index("sales_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("sales_branch_idx").on(t.tenantId, t.branchId, t.createdAt),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
    productId: uuid("product_id"),
    variantId: uuid("variant_id"),
    name: text("name").notNull(),
    sku: text("sku"),
    quantity: qty("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    unitCost: money("unit_cost").notNull().default("0"),
    discount: money("discount").notNull().default("0"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    lineTotal: money("line_total").notNull(),
    modifiers: jsonb("modifiers").$type<{ name: string; price: number }[]>().notNull().default([]),
    refundedQty: qty("refunded_qty").notNull().default("0"),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId), index("sale_items_product_idx").on(t.tenantId, t.productId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "cascade" }),
    method: text("method").$type<"cash" | "card" | "transfer" | "paystack" | "flutterwave" | "stripe" | "credit" | "terminal">().notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").$type<"pending" | "succeeded" | "failed" | "refunded">().notNull().default("succeeded"),
    reference: text("reference"),
    gatewayRef: text("gateway_ref"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_sale_idx").on(t.saleId),
    uniqueIndex("payments_tenant_idem_uq").on(t.tenantId, t.idempotencyKey),
  ],
);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  reason: text("reason"),
  method: text("method").notNull().default("cash"),
  restock: boolean("restock").notNull().default(true),
  items: jsonb("items").$type<{ saleItemId: string; quantity: string }[]>().notNull().default([]),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("approved"),
  approvedBy: uuid("approved_by"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const suspendedCarts = pgTable("suspended_carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  label: text("label").notNull(),
  cart: jsonb("cart").$type<unknown>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const cashDrawerSessions = pgTable("cash_drawer_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  openedBy: uuid("opened_by").notNull(),
  closedBy: uuid("closed_by"),
  openingFloat: money("opening_float").notNull().default("0"),
  closingCount: money("closing_count"),
  expectedCash: money("expected_cash").notNull().default("0"),
  variance: money("variance"),
  status: text("status").$type<"open" | "closed">().notNull().default("open"),
  openedAt: ts("opened_at").defaultNow().notNull(),
  closedAt: ts("closed_at"),
});

/* ─────────────────────────────── Finance ────────────────────────────────── */

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<"asset" | "liability" | "equity" | "revenue" | "expense">().notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("accounts_tenant_code_uq").on(t.tenantId, t.code)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id"),
    entryNumber: text("entry_number").notNull(),
    date: ts("date").notNull().defaultNow(),
    memo: text("memo").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    currency: text("currency").notNull().default("NGN"),
    createdBy: uuid("created_by"),
    isClosing: boolean("is_closing").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("journal_entries_tenant_idx").on(t.tenantId, t.date), uniqueIndex("journal_tenant_number_uq").on(t.tenantId, t.entryNumber)],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    description: text("description"),
  },
  (t) => [index("journal_lines_entry_idx").on(t.entryId), index("journal_lines_account_idx").on(t.tenantId, t.accountId)],
);

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id"),
    categoryId: uuid("category_id"),
    supplierId: uuid("supplier_id"),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    date: ts("date").notNull().defaultNow(),
    method: text("method").notNull().default("cash"),
    status: text("status").$type<"pending" | "approved" | "paid">().notNull().default("paid"),
    receiptUrl: text("receipt_url"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_tenant_date_idx").on(t.tenantId, t.date)],
);

export const financialPeriods = pgTable("financial_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  status: text("status").$type<"open" | "closed">().notNull().default("open"),
  closedBy: uuid("closed_by"),
  closedAt: ts("closed_at"),
  summary: jsonb("summary").$type<Record<string, string>>().notNull().default({}),
});

/* ─────────────────────────────── Employees ──────────────────────────────── */

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    branchId: uuid("branch_id"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    position: text("position").notNull().default("Staff"),
    department: text("department"),
    salary: money("salary").notNull().default("0"),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    status: text("status").$type<"active" | "on_leave" | "suspended" | "terminated">().notNull().default("active"),
    hiredAt: ts("hired_at").defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("employees_tenant_idx").on(t.tenantId)],
);

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id"),
    clockIn: ts("clock_in").defaultNow().notNull(),
    clockOut: ts("clock_out"),
    minutesWorked: integer("minutes_worked"),
    note: text("note"),
  },
  (t) => [index("attendance_emp_idx").on(t.tenantId, t.employeeId)],
);

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  role: text("role"),
  status: text("status").$type<"scheduled" | "completed" | "missed">().notNull().default("scheduled"),
  createdAt: createdAt(),
});

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  reason: text("reason"),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
  decidedBy: uuid("decided_by"),
  createdAt: createdAt(),
});

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  periodLabel: text("period_label").notNull(),
  grossTotal: money("gross_total").notNull().default("0"),
  deductionsTotal: money("deductions_total").notNull().default("0"),
  netTotal: money("net_total").notNull().default("0"),
  lines: jsonb("lines").$type<{ employeeId: string; name: string; base: string; commission: string; deductions: string; net: string }[]>().notNull().default([]),
  status: text("status").$type<"draft" | "approved" | "paid">().notNull().default("draft"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

/* ─────────────────────── Restaurant & hospitality ───────────────────────── */

export const restaurants = pgTable("restaurants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").notNull(),
  name: text("name").notNull(),
  serviceChargeRate: numeric("service_charge_rate", { precision: 6, scale: 3 }).notNull().default("0"),
  prepStations: jsonb("prep_stations").$type<string[]>().notNull().default(["kitchen", "bar"]),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const restaurantTables = pgTable(
  "restaurant_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    seats: integer("seats").notNull().default(4),
    area: text("area").default("main"),
    status: text("status").$type<"free" | "occupied" | "reserved" | "cleaning">().notNull().default("free"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tables_branch_label_uq").on(t.branchId, t.label)],
);

export const menus = pgTable("menus", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  branchId: uuid("branch_id"),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  menuId: uuid("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull(),
  price: money("price").notNull(),
  station: text("station").notNull().default("kitchen"),
  modifiers: jsonb("modifiers").$type<{ name: string; price: string }[]>().notNull().default([]),
  recipe: jsonb("recipe").$type<{ productId: string; quantity: string }[]>().notNull().default([]),
  isAvailable: boolean("is_available").notNull().default(true),
});

export const kitchenOrders = pgTable(
  "kitchen_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "set null" }),
    tableId: uuid("table_id"),
    ticketNumber: text("ticket_number").notNull(),
    station: text("station").notNull().default("kitchen"),
    status: text("status").$type<"queued" | "preparing" | "ready" | "served" | "cancelled">().notNull().default("queued"),
    items: jsonb("items").$type<{ name: string; quantity: string; notes?: string }[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: createdAt(),
    readyAt: ts("ready_at"),
    servedAt: ts("served_at"),
  },
  (t) => [index("kitchen_tenant_status_idx").on(t.tenantId, t.status)],
);

export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  tableId: uuid("table_id"),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  partySize: integer("party_size").notNull().default(2),
  reservedAt: ts("reserved_at").notNull(),
  status: text("status").$type<"booked" | "seated" | "completed" | "no_show" | "cancelled">().notNull().default("booked"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/* ─────────────────────────── Plans & subscriptions ──────────────────────── */

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceMonthly: money("price_monthly").notNull().default("0"),
    priceYearly: money("price_yearly").notNull().default("0"),
    currency: text("currency").notNull().default("NGN"),
    trialDays: integer("trial_days").notNull().default(14),
    limits: jsonb("limits")
      .$type<{ branches: number; users: number; products: number; terminals: number; aiTokens: number; automations: number }>()
      .notNull()
      .default({ branches: 1, users: 3, products: 200, terminals: 1, aiTokens: 50000, automations: 0 }),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("plans_code_uq").on(t.code)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    status: text("status").$type<"trialing" | "active" | "past_due" | "cancelled" | "expired">().notNull().default("trialing"),
    interval: text("interval").$type<"monthly" | "yearly">().notNull().default("monthly"),
    gateway: text("gateway").$type<"paystack" | "flutterwave" | "stripe" | "manual">().notNull().default("manual"),
    gatewayRef: text("gateway_ref"),
    seats: integer("seats").notNull().default(1),
    trialEndsAt: ts("trial_ends_at"),
    currentPeriodStart: ts("current_period_start").defaultNow().notNull(),
    currentPeriodEnd: ts("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("subscriptions_tenant_uq").on(t.tenantId)],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    gateway: text("gateway").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    amount: money("amount").notNull().default("0"),
    status: text("status").notNull().default("processed"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_events_gateway_event_uq").on(t.gateway, t.eventId)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    status: text("status").$type<"received" | "processed" | "failed" | "ignored">().notNull().default("received"),
    signatureValid: boolean("signature_valid").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    receivedAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_source_uq").on(t.source, t.eventId)],
);

/* ───────────────────────────────── AI ───────────────────────────────────── */

export const aiProviders = pgTable(
  "ai_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<"agnes" | "openai" | "huggingface" | "anthropic" | "custom">().notNull(),
    baseUrl: text("base_url"),
    apiKeyEncrypted: text("api_key_encrypted"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    monthlyBudget: money("monthly_budget").notNull().default("0"),
    spendThisMonth: money("spend_this_month").notNull().default("0"),
    status: text("status").$type<"healthy" | "degraded" | "unconfigured" | "disabled">().notNull().default("unconfigured"),
    lastCheckedAt: ts("last_checked_at"),
    notes: text("notes"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_providers_key_uq").on(t.key)],
);

export const aiModels = pgTable(
  "ai_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id").notNull().references(() => aiProviders.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    modelId: text("model_id").notNull(),
    task: text("task").$type<"chat" | "analysis" | "forecast" | "embedding" | "vision" | "summarise">().notNull().default("chat"),
    maxTokens: integer("max_tokens").notNull().default(2048),
    temperature: numeric("temperature", { precision: 4, scale: 2 }).notNull().default("0.30"),
    inputCostPer1k: money("input_cost_per_1k").notNull().default("0"),
    outputCostPer1k: money("output_cost_per_1k").notNull().default("0"),
    isDefault: boolean("is_default").notNull().default(false),
    isFallback: boolean("is_fallback").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_models_provider_model_uq").on(t.providerId, t.modelId)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    userId: uuid("user_id"),
    providerKey: text("provider_key"),
    modelLabel: text("model_label"),
    task: text("task").notNull().default("chat"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cost: money("cost").notNull().default("0"),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status").$type<"success" | "error" | "fallback" | "quota_blocked">().notNull().default("success"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_tenant_idx").on(t.tenantId, t.createdAt), index("ai_usage_provider_idx").on(t.providerKey, t.createdAt)],
);

export const aiInsights = pgTable(
  "ai_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: text("severity").$type<"info" | "warning" | "critical" | "success">().notNull().default("info"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    dismissedAt: ts("dismissed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_insights_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_conversations_tenant_idx").on(t.tenantId, t.userId)],
);

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "tool">().notNull(),
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<{ name: string; args: Record<string, unknown>; result?: unknown }[]>().notNull().default([]),
  isEstimate: boolean("is_estimate").notNull().default(false),
  createdAt: createdAt(),
});

/* ───────────────────────────── Automation ───────────────────────────────── */

export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    triggerType: text("trigger_type").$type<"schedule" | "event" | "threshold">().notNull(),
    triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull().default({}),
    conditions: jsonb("conditions").$type<Record<string, unknown>[]>().notNull().default([]),
    actionType: text("action_type").$type<"notify" | "email" | "report" | "restock_suggestion" | "create_po" | "webhook">().notNull(),
    actionConfig: jsonb("action_config").$type<Record<string, unknown>>().notNull().default({}),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    lastRunAt: ts("last_run_at"),
    runCount: integer("run_count").notNull().default(0),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automation_rules_tenant_idx").on(t.tenantId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ruleId: uuid("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    status: text("status").$type<"success" | "failed" | "skipped" | "awaiting_approval">().notNull(),
    output: text("output"),
    error: text("error"),
    startedAt: ts("started_at").defaultNow().notNull(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("automation_runs_tenant_idx").on(t.tenantId, t.startedAt)],
);

/* ─────────────────────── Integrations, storefront ───────────────────────── */

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    configEncrypted: text("config_encrypted"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    status: text("status").notNull().default("disconnected"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_tenant_kind_uq").on(t.tenantId, t.kind)],
);

export const storefronts = pgTable(
  "storefronts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    headline: text("headline"),
    about: text("about"),
    currency: text("currency").notNull().default("NGN"),
    deliveryFee: money("delivery_fee").notNull().default("0"),
    isPublished: boolean("is_published").notNull().default(false),
    accentColor: text("accent_color").notNull().default("#20B26B"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("storefronts_slug_uq").on(t.slug)],
);

/* ─────────────────────── Audit, jobs, support, limits ───────────────────── */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    severity: text("severity").$type<"info" | "warning" | "critical">().notNull().default("info"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt), index("audit_logs_action_idx").on(t.action)],
);

export const jobQueue = pgTable(
  "job_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: text("queue").notNull().default("default"),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"queued" | "active" | "completed" | "failed">().notNull().default("queued"),
    runAt: ts("run_at").defaultNow().notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    tenantId: uuid("tenant_id"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("job_queue_status_idx").on(t.status, t.runAt)],
);

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").$type<"open" | "pending" | "resolved" | "closed">().notNull().default("open"),
  priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket").notNull(),
    identifier: text("identifier").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rate_limit_bucket_idx").on(t.bucket, t.identifier, t.createdAt)],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
