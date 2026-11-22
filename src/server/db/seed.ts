/**
 * MERVO seed — idempotent demo dataset used for local development, demos and
 * automated tests. NEVER run this against production customer data:
 *
 *   npm run db:seed            (skips if a workspace already exists)
 *   npm run db:seed -- --force (wipes demo tenant only)
 */
import { and, eq, sql } from "drizzle-orm";
import { hashPassword, encryptSecret } from "@/server/lib/crypto";
import { multiply } from "@/server/lib/money";
import {
  aiInsights,
  aiModels,
  aiProviders,
  auditLogs,
    branches,
  businesses,
  categories,
  customers,
  employees,
    memberships,
  menuItems,
  menus,
  plans,
  platformSettings,
  products,
  purchaseOrders,
  restaurantTables,
  restaurants,
  roles,
  storefronts,
  suppliers,
  tenants,
  users,
} from "./schema";
import type { Db } from "./index";
import { getDb } from "./index";
import { ensureSystemRoles, getOrCreateRole, provisionBusiness } from "@/server/services/tenants";
import { applyStockMovement } from "@/server/services/inventory";
import { createSale, refundSale } from "@/server/services/sales";
import { recordExpense } from "@/server/services/finance";
import { createRule, AUTOMATION_TEMPLATES } from "@/server/services/automation";
import { DEFAULT_BASE_URLS } from "@/server/ai/providers";
import { refreshInsights } from "@/server/ai/insights";
import { enqueue } from "@/server/jobs/queue";

const PLAN_SEED = [
  {
    code: "free",
    name: "Free",
    description: "Try MERVO with one branch and one terminal.",
    priceMonthly: "0",
    priceYearly: "0",
    trialDays: 14,
    limits: { branches: 1, users: 3, products: 200, terminals: 1, aiTokens: 50_000, automations: 0 },
    features: ["1 branch", "1 POS terminal", "Basic inventory", "Basic reports", "Limited AI insights"],
    sortOrder: 1,
  },
  {
    code: "starter",
    name: "Starter",
    description: "For small shops going digital.",
    priceMonthly: "12000",
    priceYearly: "120000",
    trialDays: 14,
    limits: { branches: 2, users: 8, products: 2000, terminals: 3, aiTokens: 300_000, automations: 3 },
    features: ["2 branches", "8 users", "Advanced inventory", "Customer management", "AI reports", "Email support"],
    sortOrder: 2,
  },
  {
    code: "growth",
    name: "Growth",
    description: "For growing multi-branch businesses.",
    priceMonthly: "35000",
    priceYearly: "350000",
    trialDays: 14,
    limits: { branches: 6, users: 25, products: 20_000, terminals: 10, aiTokens: 1_500_000, automations: 15 },
    features: ["6 branches", "25 users", "AI inventory recommendations", "Automation engine", "Advanced analytics", "Priority support"],
    sortOrder: 3,
  },
  {
    code: "business",
    name: "Business",
    description: "Full accounting, e-commerce and controls.",
    priceMonthly: "75000",
    priceYearly: "750000",
    trialDays: 14,
    limits: { branches: 20, users: 100, products: 100_000, terminals: 50, aiTokens: 5_000_000, automations: 50 },
    features: ["20 branches", "Double-entry accounting", "E-commerce storefront", "Advanced permissions", "Audit trail", "Restaurant module"],
    sortOrder: 4,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Custom limits, integrations and dedicated support.",
    priceMonthly: "150000",
    priceYearly: "1500000",
    trialDays: 30,
    limits: { branches: -1, users: -1, products: -1, terminals: -1, aiTokens: 20_000_000, automations: -1 },
    features: ["Unlimited branches", "Unlimited users", "Custom integrations", "Dedicated support", "SLA & onboarding", "Custom AI models"],
    sortOrder: 5,
  },
];

type ModelSeed = { label: string; modelId: string; task: "chat" | "analysis" | "forecast"; isDefault?: boolean; isFallback?: boolean; maxTokens: number; inputCostPer1k: string; outputCostPer1k: string };
type ProviderSeed = { key: string; name: string; kind: "agnes" | "openai" | "huggingface"; priority: number; envKey: string; models: ModelSeed[] };

const AI_PROVIDER_SEED: ProviderSeed[] = [
  {
    key: "agnes",
    name: "Agnes AI",
    kind: "agnes" as const,
    priority: 1,
    envKey: "AGNES_API_KEY",
    models: [
      { label: "Agnes Business Chat", modelId: "agnes-chat-pro", task: "chat" as const, isDefault: true, maxTokens: 3000, inputCostPer1k: "0.40", outputCostPer1k: "1.20" },
      { label: "Agnes Analyst", modelId: "agnes-analyst", task: "analysis" as const, isFallback: true, maxTokens: 4000, inputCostPer1k: "0.60", outputCostPer1k: "1.80" },
    ],
  },
  {
    key: "openai",
    name: "OpenAI",
    kind: "openai" as const,
    priority: 2,
    envKey: "OPENAI_API_KEY",
    models: [{ label: "GPT-4o mini", modelId: "gpt-4o-mini", task: "chat" as const, isFallback: true, maxTokens: 2048, inputCostPer1k: "0.15", outputCostPer1k: "0.60" }],
  },
  {
    key: "huggingface",
    name: "Hugging Face",
    kind: "huggingface" as const,
    priority: 3,
    envKey: "HF_TOKEN",
    models: [{ label: "Llama 3.1 8B Instruct", modelId: "meta-llama/Llama-3.1-8B-Instruct", task: "chat" as const, isFallback: true, maxTokens: 2048, inputCostPer1k: "0.05", outputCostPer1k: "0.10" }],
  },
];

const CATALOGUE: { name: string; sku: string; price: string; cost: string; cat: string; unit: string; menu?: boolean }[] = [
  { name: "Rice 5kg Premium", sku: "RICE-5KG", price: "8500", cost: "6900", cat: "Grains", unit: "bag" },
  { name: "Rice 25kg Bag", sku: "RICE-25KG", price: "38000", cost: "31500", cat: "Grains", unit: "bag" },
  { name: "Beans 2kg", sku: "BEAN-2KG", price: "4200", cost: "3300", cat: "Grains", unit: "bag" },
  { name: "Vegetable Oil 5L", sku: "OIL-5L", price: "9500", cost: "7600", cat: "Groceries", unit: "pcs" },
  { name: "Tomato Paste 400g", sku: "TOMATO-400", price: "1200", cost: "850", cat: "Groceries", unit: "tin" },
  { name: "Milk Powder 400g", sku: "MILK-400", price: "3800", cost: "2950", cat: "Dairy", unit: "tin" },
  { name: "Sugar 1kg", sku: "SUGAR-1KG", price: "1800", cost: "1300", cat: "Groceries", unit: "bag" },
  { name: "Salt 500g", sku: "SALT-500", price: "600", cost: "350", cat: "Groceries", unit: "pcs" },
  { name: "Bread Loaf", sku: "BREAD-01", price: "1500", cost: "1000", cat: "Bakery", unit: "pcs" },
  { name: "Eggs (Crate)", sku: "EGG-CRATE", price: "4800", cost: "3900", cat: "Dairy", unit: "crate" },
  { name: "Bottled Water 75cl", sku: "WATER-75", price: "350", cost: "180", cat: "Beverages", unit: "pcs" },
  { name: "Coca-Cola 50cl", sku: "COKE-50", price: "400", cost: "250", cat: "Beverages", unit: "pcs" },
  { name: "Malt Drink 33cl", sku: "MALT-33", price: "500", cost: "330", cat: "Beverages", unit: "pcs" },
  { name: "Instant Coffee 100g", sku: "COFFEE-100", price: "4200", cost: "3200", cat: "Beverages", unit: "jar" },
  { name: "Detergent 1kg", sku: "DETER-1KG", price: "2500", cost: "1750", cat: "Household", unit: "bag" },
  { name: "Bar Soap", sku: "SOAP-BAR", price: "900", cost: "550", cat: "Household", unit: "pcs" },
  { name: "Toothpaste 140g", sku: "TOOTH-140", price: "1600", cost: "1050", cat: "Household", unit: "pcs" },
  { name: "USB-C Cable 2m", sku: "USBC-2M", price: "3500", cost: "1900", cat: "Accessories", unit: "pcs" },
  { name: "20W Charger", sku: "CHRG-20W", price: "6500", cost: "3800", cat: "Accessories", unit: "pcs" },
  { name: "Wireless Earbuds", sku: "BUDS-01", price: "18500", cost: "12000", cat: "Accessories", unit: "pcs" },
  { name: "Power Bank 10000mAh", sku: "PBANK-10", price: "15000", cost: "9800", cat: "Accessories", unit: "pcs" },
  { name: "Phone Screen Guard", sku: "GUARD-01", price: "2500", cost: "900", cat: "Accessories", unit: "pcs" },
  { name: "Paracetamol 12s", sku: "PARA-12", price: "800", cost: "420", cat: "Pharmacy", unit: "pack" },
  { name: "Vitamin C 100s", sku: "VITC-100", price: "3200", cost: "2100", cat: "Pharmacy", unit: "bottle" },
  { name: "Jollof Rice Plate", sku: "MENU-JOLLOF", price: "3500", cost: "1500", cat: "Kitchen", unit: "plate", menu: true },
  { name: "Fried Rice Plate", sku: "MENU-FRIED", price: "3800", cost: "1650", cat: "Kitchen", unit: "plate", menu: true },
  { name: "Grilled Chicken", sku: "MENU-CHICKEN", price: "4500", cost: "2400", cat: "Kitchen", unit: "portion", menu: true },
  { name: "Pepper Soup", sku: "MENU-SOUP", price: "2800", cost: "1200", cat: "Kitchen", unit: "bowl", menu: true },
  { name: "Chapman Cocktail", sku: "BAR-CHAPMAN", price: "2500", cost: "800", cat: "Bar", unit: "glass", menu: true },
  { name: "Bottled Beer", sku: "BAR-BEER", price: "1800", cost: "1100", cat: "Bar", unit: "bottle", menu: true },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedPlans(db: Db) {
  for (const plan of PLAN_SEED) {
    await db
      .insert(plans)
      .values({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        trialDays: plan.trialDays,
        limits: plan.limits,
        features: plan.features,
        sortOrder: plan.sortOrder,
        currency: "NGN",
      })
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          limits: plan.limits,
          features: plan.features,
          sortOrder: plan.sortOrder,
          updatedAt: new Date(),
        },
      });
  }
}

export async function seedAIProviders(db: Db) {
  for (const provider of AI_PROVIDER_SEED) {
    const envValue = process.env[provider.envKey];
    const [row] = await db
      .insert(aiProviders)
      .values({
        key: provider.key,
        name: provider.name,
        kind: provider.kind,
        baseUrl: DEFAULT_BASE_URLS[provider.kind] ?? "",
        priority: provider.priority,
        isEnabled: true,
        status: envValue ? "healthy" : "unconfigured",
        apiKeyEncrypted: envValue ? encryptSecret(envValue) : null,
        notes: envValue ? `Key loaded from ${provider.envKey}` : `Awaiting ${provider.envKey} in the environment or Super Admin → AI.`,
      })
      .onConflictDoUpdate({
        target: aiProviders.key,
        set: {
          name: provider.name,
          kind: provider.kind,
          baseUrl: DEFAULT_BASE_URLS[provider.kind] ?? "",
          priority: provider.priority,
          ...(envValue ? { apiKeyEncrypted: encryptSecret(envValue), status: "healthy" as const } : {}),
        },
      })
      .returning({ id: aiProviders.id });
    for (const model of provider.models) {
      await db
        .insert(aiModels)
        .values({
          providerId: row!.id,
          label: model.label,
          modelId: model.modelId,
          task: model.task,
          isDefault: model.isDefault ?? false,
          isFallback: model.isFallback ?? false,
          maxTokens: model.maxTokens,
          inputCostPer1k: model.inputCostPer1k,
          outputCostPer1k: model.outputCostPer1k,
        })
        .onConflictDoUpdate({
          target: [aiModels.providerId, aiModels.modelId],
          set: { label: model.label, task: model.task, isDefault: model.isDefault ?? false, isFallback: model.isFallback ?? false, maxTokens: model.maxTokens },
        });
    }
  }
}

export async function seedDemoTenant(db: Db, opts: { ownerEmail?: string; ownerPassword?: string } = {}) {
  const ownerEmail = opts.ownerEmail ?? "owner@mervo.app";
  const ownerPassword = opts.ownerPassword ?? "MervoDemo#2025";
  const [existing] = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (existing) return { skipped: true as const, tenantId: existing.id };

  const [owner] = await db
    .insert(users)
    .values({ email: ownerEmail, name: "Amaka Obi", passwordHash: await hashPassword(ownerPassword), emailVerifiedAt: new Date() })
    .onConflictDoUpdate({ target: users.email, set: { name: "Amaka Obi" } })
    .returning({ id: users.id });

  const provisioned = await provisionBusiness(db, {
    ownerUserId: owner!.id,
    businessName: "Mervo Demo Mart",
    industry: "retail",
    currency: "NGN",
    country: "NG",
    planCode: "growth",
    withRestaurant: true,
  });

  const { tenantId, branchId } = provisioned;
  await db.update(tenants).set({ status: "active", aiTokensLimit: 2_000_000 }).where(eq(tenants.id, tenantId));
  await db.update(businesses).set({ address: "18 Adeola Odeku Street, Victoria Island", city: "Lagos", phone: "+234 801 234 5678", email: ownerEmail, industry: "retail" }).where(eq(businesses.tenantId, tenantId));

  const [branch2] = await db
    .insert(branches)
    .values({ tenantId, name: "Mervo Demo Mart — Lekki", code: "LEKKI", address: "Plot 12 Admiralty Way, Lekki Phase 1", phone: "+234 802 345 6789", type: "store" })
    .returning({ id: branches.id });

  // Staff users + roles
  const [manager] = await db
    .insert(users)
    .values({ email: "manager@mervo.app", name: "Tunde Bello", passwordHash: await hashPassword("MervoManager#2025"), emailVerifiedAt: new Date() })
    .onConflictDoUpdate({ target: users.email, set: { name: "Tunde Bello" } })
    .returning({ id: users.id });
  const [cashier] = await db
    .insert(users)
    .values({ email: "cashier@mervo.app", name: "Ngozi Eze", passwordHash: await hashPassword("MervoCashier#2025"), emailVerifiedAt: new Date() })
    .onConflictDoUpdate({ target: users.email, set: { name: "Ngozi Eze" } })
    .returning({ id: users.id });

  for (const member of [
    { userId: manager!.id, roleKey: "branch_manager", title: "Branch Manager" },
    { userId: cashier!.id, roleKey: "cashier", title: "Cashier" },
  ]) {
    const roleId = await getOrCreateRole(db, tenantId, member.roleKey);
    await db
      .insert(memberships)
      .values({ tenantId, userId: member.userId, roleId, branchId, status: "active", title: member.title })
      .onConflictDoNothing();
  }

  // Restaurant setup
  const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.tenantId, tenantId)).limit(1);
  if (restaurant) {
    await db.update(restaurantTables).set({ status: "occupied" }).where(and(eq(restaurantTables.tenantId, tenantId), eq(restaurantTables.label, "T2")));
  }

  // Catalogue
  const categoryNames = [...new Set(CATALOGUE.map((c) => c.cat))];
  const categoryRows = await db
    .insert(categories)
    .values(categoryNames.map((name) => ({ tenantId, name })))
    .returning({ id: categories.id, name: categories.name });
  const categoryMap = new Map(categoryRows.map((c) => [c.name, c.id]));

  const supplierRows = await db
    .insert(suppliers)
    .values([
      { tenantId, name: "Lagos Wholesale Depot", contactName: "Emeka Nwosu", phone: "+234 803 111 2222", email: "sales@lagoswholesale.ng", balanceOwed: "145000" },
      { tenantId, name: "Fresh Farms Produce", contactName: "Bisi Adeyemi", phone: "+234 805 333 4444", email: "orders@freshfarms.ng", balanceOwed: "38500" },
      { tenantId, name: "TechHub Accessories", contactName: "Kelvin Ade", phone: "+234 807 555 6666", email: "kelvin@techhub.ng", balanceOwed: "0" },
    ])
    .returning({ id: suppliers.id, name: suppliers.name });

  const productRows = await db
    .insert(products)
    .values(
      CATALOGUE.map((item) => ({
        tenantId,
        categoryId: categoryMap.get(item.cat) ?? null,
        supplierId: supplierRows[0]!.id,
        name: item.name,
        sku: item.sku,
        barcode: `M${item.sku.replace(/[^A-Z0-9]/g, "")}`.slice(0, 20),
        brand: "Mervo Select",
        unit: item.unit,
        costPrice: item.cost,
        price: item.price,
        wholesalePrice: multiply(item.price, "0.92"),
        taxRate: "7.5",
        reorderPoint: item.menu ? "0" : "12",
        reorderQty: item.menu ? "0" : "40",
        isMenuItem: Boolean(item.menu),
        trackStock: true,
      })),
    )
    .returning({ id: products.id, name: products.name, sku: products.sku, price: products.price, costPrice: products.costPrice, taxRate: products.taxRate, isMenuItem: products.isMenuItem });

  // Opening stock for both branches
  const rand = mulberry32(20240517);
  for (const product of productRows) {
    for (const bid of [branchId, branch2!.id]) {
      const qty = product.isMenuItem ? 80 + Math.floor(rand() * 60) : 45 + Math.floor(rand() * 140);
      await applyStockMovement(db, {
        tenantId,
        branchId: bid,
        productId: product.id,
        type: "opening",
        quantityDelta: `${qty}.000`,
        unitCost: product.costPrice,
        reason: "Opening stock",
        createdBy: owner!.id,
      });
    }
  }

  // Customers
  const customerSeed = [
    { name: "Chinedu Okafor", phone: "+234 811 222 3344", email: "chinedu@example.com", consent: true },
    { name: "Fatima Yusuf", phone: "+234 812 333 4455", email: "fatima@example.com", consent: true },
    { name: "Grace Adebayo", phone: "+234 813 444 5566", email: "grace@example.com", consent: false },
    { name: "Ibrahim Musa", phone: "+234 814 555 6677", email: "ibrahim@example.com", consent: true },
    { name: "Blessing Nkem", phone: "+234 815 666 7788", email: "blessing@example.com", consent: true },
    { name: "Samuel Ogun", phone: "+234 816 777 8899", email: "samuel@example.com", consent: false },
    { name: "Aisha Bello", phone: "+234 817 888 9900", email: "aisha@example.com", consent: true },
    { name: "Kelechi Umeh", phone: "+234 818 999 0011", email: "kelechi@example.com", consent: true },
  ];
  const customerRows = await db
    .insert(customers)
    .values(
      customerSeed.map((c) => ({
        tenantId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        creditLimit: "150000",
        marketingConsent: c.consent,
        whatsappConsent: c.consent,
        createdBy: owner!.id,
      })),
    )
    .returning({ id: customers.id, name: customers.name });

  // Employees
  await db.insert(employees).values([
    { tenantId, userId: cashier!.id, branchId, name: "Ngozi Eze", email: "cashier@mervo.app", position: "Cashier", department: "Sales", salary: "120000", commissionRate: "1.5" },
    { tenantId, userId: manager!.id, branchId, name: "Tunde Bello", email: "manager@mervo.app", position: "Branch Manager", department: "Operations", salary: "250000", commissionRate: "0.5" },
    { tenantId, branchId, name: "Emeka Obi", phone: "+234 809 123 0000", position: "Sales Representative", department: "Sales", salary: "95000", commissionRate: "2" },
    { tenantId, branchId: branch2!.id, name: "Halima Sule", phone: "+234 809 456 1111", position: "Inventory Officer", department: "Operations", salary: "130000" },
  ]);

  // ── 45 days of trading history ───────────────────────────────────────────────
  const saleProducts = productRows.filter((p) => !p.isMenuItem);
  const menuProducts = productRows.filter((p) => p.isMenuItem);
  let saleIndex = 0;
  for (let dayOffset = 44; dayOffset >= 0; dayOffset--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - dayOffset);
    const weekday = dayStart.getDay();
    const weekendBoost = weekday === 0 || weekday === 6 ? 1.4 : 1;
    const growth = 1 + (44 - dayOffset) * 0.006;
    const transactions = Math.max(3, Math.round((6 + rand() * 6) * weekendBoost * growth));

    for (let t = 0; t < transactions; t++) {
      const soldAt = new Date(dayStart.getTime() + (9 + Math.floor(rand() * 11)) * 3600 * 1000 + Math.floor(rand() * 60) * 60000);
      const branchForSale = rand() > 0.72 ? branch2!.id : branchId;
      const isRestaurant = rand() > 0.78;
      const pool = isRestaurant ? [...saleProducts, ...menuProducts] : saleProducts;
      const lineCount = 1 + Math.floor(rand() * 4);
      const picked = new Map<string, { productId: string; name: string; quantity: string; unitPrice: string }>();
      for (let l = 0; l < lineCount; l++) {
        const product = pool[Math.floor(rand() * pool.length)]!;
        const qty = 1 + Math.floor(rand() * 3);
        const existing = picked.get(product.id);
        if (existing) existing.quantity = `${Number(existing.quantity) + qty}.000`;
        else picked.set(product.id, { productId: product.id, name: product.name, quantity: `${qty}.000`, unitPrice: product.price });
      }
      const items = [...picked.values()];
      const ne = Number(saleProducts.find((p) => p.id === items[0]!.productId)?.price ?? 0);
      const estimate = items.reduce((acc, i) => acc + Number(i.unitPrice) * Number(i.quantity), 0);
      const useCustomer = rand() > 0.45;
      const isCredit = rand() > 0.86;
      const customer = useCustomer || isCredit ? customerRows[Math.floor(rand() * customerRows.length)] : null;
      const grossWithTax = estimate * 1.075;
      const method: "cash" | "card" | "transfer" = rand() > 0.55 ? "cash" : rand() > 0.4 ? "card" : "transfer";
      const paid = isCredit ? (grossWithTax * 0.4).toFixed(2) : (Math.ceil(grossWithTax / 100) * 100 + 100).toFixed(2);
      void ne;
      try {
        const sale = await createSale(
          { db, tenantId, userId: owner!.id, permissions: ["*"] },
          {
            branchId: branchForSale,
            customerId: customer?.id ?? null,
            items,
            payments: isCredit
              ? [{ method, amount: paid }, { method: "credit", amount: (grossWithTax - Number(paid)).toFixed(2) }]
              : [{ method, amount: paid }],
            idempotencyKey: `seed-${tenantId}-${saleIndex++}-${soldAt.getTime()}`,
            source: isRestaurant ? "restaurant" : "pos",
            soldAt,
          },
        );
        if (authPassRand(rand, 0.04)) {
          const saleItemRows = await db.execute(sql`select id, quantity from sale_items where sale_id = ${sale.saleId} limit 1`);
          const firstItem = (saleItemRows.rows as { id: string; quantity: string }[])[0];
          if (firstItem) {
            await refundSale(
              { db, tenantId, userId: owner!.id, permissions: ["*"] },
              {
                saleId: sale.saleId,
                items: [{ saleItemId: firstItem.id, quantity: "1.000" }],
                reason: "Customer returned one item",
                method: "cash",
                refundedAt: new Date(soldAt.getTime() + 3600_000),
              },
            ).catch((error) => console.warn("seed refund skipped:", error instanceof Error ? error.message : error));
          }
        }
      } catch (error) {
        console.warn("seed sale skipped:", error instanceof Error ? error.message : error);
      }
    }

    // weekly expenses
    if (dayOffset % 7 === 0) {
      const expenseDay = new Date(dayStart.getTime() + 13 * 3600 * 1000);
      for (const expense of [
        { description: "Diesel for generator", amount: "18000" },
        { description: "Staff transport allowance", amount: "9500" },
        { description: "Shop rent (weekly accrual)", amount: "45000" },
      ]) {
        await recordExpense(db, { tenantId, userId: owner!.id, description: expense.description, amount: expense.amount, method: "cash", branchId, date: expenseDay });
      }
    }
  }

  // Purchase orders
  const [po] = await db
    .insert(purchaseOrders)
    .values({ tenantId, branchId, supplierId: supplierRows[0]!.id, reference: "PO-00001", status: "ordered", subtotal: "325000", total: "325000", amountPaid: "180000", createdBy: owner!.id })
    .returning({ id: purchaseOrders.id });
  void po;

  // Automation rules
  for (const template of AUTOMATION_TEMPLATES.slice(0, 5)) {
    await createRule(db, tenantId, {
      name: template.name,
      triggerType: template.triggerType,
      triggerConfig: template.triggerConfig,
      actionType: template.actionType,
      actionConfig: template.actionConfig,
      requiresApproval: false,
      createdBy: owner!.id,
    });
  }

  // Storefront + menus
  await db
    .update(storefronts)
    .set({ slug: "mervo-demo-mart", headline: "Fresh groceries and fast food, delivered in Lagos", about: "Order from Mervo Demo Mart for same-day delivery across Lagos Island.", isPublished: true, deliveryFee: "1500" })
    .where(eq(storefronts.tenantId, tenantId));

  const [menu] = await db.select().from(menus).where(eq(menus.tenantId, tenantId)).limit(1);
  if (menu) {
    await db
      .insert(menuItems)
      .values(
        menuProducts.map((p) => ({
          tenantId,
          menuId: menu.id,
          productId: p.id,
          price: p.price,
          station: p.name.includes("Chapman") || p.name.includes("Beer") ? "bar" : "kitchen",
          modifiers: p.name.includes("Chicken") ? [{ name: "Extra spicy", price: "0" }, { name: "Extra portion", price: "1500" }] : [],
          recipe: [],
        })),
      )
      .onConflictDoNothing();
  }

  // Insights + audit trail + queued jobs
  await refreshInsights(db, tenantId);
  await db.insert(aiInsights).values({
    tenantId,
    kind: "welcome",
    title: "MERVO is analysing your business",
    body: "Your workspace is live. Ask the AI assistant anything about sales, profit, stock or customers — every answer is computed from your own ledger.",
    severity: "success",
    data: {},
  });
  await db.insert(auditLogs).values([
    { tenantId, actorId: owner!.id, actorEmail: ownerEmail, action: "business.provisioned", entity: "tenant", entityId: tenantId, severity: "info", metadata: { plan: "growth" } },
    { tenantId, actorId: owner!.id, actorEmail: ownerEmail, action: "catalogue.imported", entity: "product", entityId: null, severity: "info", metadata: { products: productRows.length } },
  ]);
  await enqueue(db, { name: "generate-insights", tenantId });
  await enqueue(db, { name: "refresh-customer-segments", tenantId });

  return { skipped: false as const, tenantId, ownerEmail, ownerPassword, products: productRows.length };
}

function authPassRand(rand: () => number, threshold: number) {
  return rand() < threshold;
}

export async function seedSuperAdmin(db: Db, email = process.env.SUPER_ADMIN_EMAIL ?? "admin@mervo.app", password = process.env.SUPER_ADMIN_PASSWORD ?? "MervoAdmin#2025") {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ isSuperAdmin: true }).where(eq(users.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [row] = await db
    .insert(users)
    .values({ email, name: "MERVO Platform Admin", passwordHash: await hashPassword(password), isSuperAdmin: true, emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  return { id: row!.id, created: true };
}

export async function seedPlatformSettings(db: Db) {
  await db
    .insert(platformSettings)
    .values([
      { key: "platform", value: { name: "MERVO", tagline: "Intelligent Business Management and AI-Powered POS Platform", supportEmail: "support@mervo.app", defaultCurrency: "NGN" } },
      { key: "ai", value: { primaryProvider: "agnes", fallbackProviders: ["openai", "huggingface"], dailyInsightRefresh: true } },
    ])
    .onConflictDoNothing();
}

export async function seedDatabase(db: Db, opts: { withDemo?: boolean } = {}) {
  await seedPlans(db);
  await seedPlatformSettings(db);
  await ensureSystemRoles(db);
  await seedAIProviders(db);
  const superAdmin = await seedSuperAdmin(db);
  const demo = opts.withDemo === false ? { skipped: true as const } : await seedDemoTenant(db);
  const [{ count: roleCount } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(roles);
  return { superAdmin, demo, roles: roleCount };
}

async function main() {
  const db = await getDb();
  const force = process.argv.includes("--force");
  if (force) {
    const [demoTenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, "mervo-demo-mart")).limit(1);
    if (demoTenant) {
      await db.delete(tenants).where(eq(tenants.id, demoTenant.id));
      console.log("Removed existing demo tenant.");
    }
  }
  const result = await seedDatabase(db, { withDemo: process.env.SEED_DEMO !== "0" });
  console.log("MERVO seed complete:", JSON.stringify(result, null, 2));
  if (!result.demo.skipped) {
    console.log(`\nOwner login:   ${result.demo.ownerEmail} / ${result.demo.ownerPassword}`);
  }
  console.log(`Super admin:   ${process.env.SUPER_ADMIN_EMAIL ?? "admin@mervo.app"} / ${process.env.SUPER_ADMIN_PASSWORD ?? "MervoAdmin#2025"}`);
  console.log("Cashier login: cashier@mervo.app / MervoCashier#2025");
  process.exit(0);
}

if (process.env.MERVO_SEED_CLI !== "0" && process.argv[1]?.includes("seed")) {
  main().catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  });
}
