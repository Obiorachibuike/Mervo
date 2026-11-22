import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toFixed(2) : v.trim()))
  .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), "Invalid amount");

export const qtyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toFixed(3) : v.trim()))
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(v), "Invalid quantity");

export const HARDENED = z.object({}).passthrough();

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: emailSchema,
  password: passwordSchema,
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  industry: z.string().trim().min(2).max(60).default("retail"),
  currency: z.enum(["NGN", "USD", "EUR", "GBP", "KES", "GHS", "ZAR"]).default("NGN"),
  country: z.string().trim().min(2).max(2).default("NG"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
  totp: z.string().trim().optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().trim().max(64).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  brand: z.string().trim().max(80).optional().nullable(),
  unit: z.string().trim().max(20).default("pcs"),
  costPrice: moneyString.default("0"),
  price: moneyString.default("0"),
  wholesalePrice: moneyString.optional().nullable(),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  trackStock: z.boolean().default(true),
  reorderPoint: qtyString.default("0"),
  reorderQty: qtyString.default("0"),
  isMenuItem: z.boolean().default(false),
});

export const cartItemSchema = z.object({
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(160).optional(),
  quantity: qtyString.refine((v) => Number(v) > 0, "Quantity must be positive"),
  unitPrice: moneyString.optional(),
  discount: moneyString.default("0"),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  modifiers: z.array(z.object({ name: z.string(), price: z.number() })).optional(),
});

export const paymentInputSchema = z.object({
  method: z.enum(["cash", "card", "transfer", "paystack", "flutterwave", "stripe", "credit", "terminal"]),
  amount: moneyString.refine((v) => Number(v) >= 0, "Amount must be >= 0"),
  reference: z.string().trim().max(120).optional(),
});

export const createSaleSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  items: z.array(cartItemSchema).min(1, "Cart is empty"),
  payments: z.array(paymentInputSchema).default([]),
  orderDiscount: moneyString.default("0"),
  notes: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(120),
  source: z.enum(["pos", "storefront", "offline_sync", "restaurant"]).default("pos"),
  taxInclusive: z.boolean().optional(),
  offlineCreatedAt: z.string().datetime().optional().nullable(),
  registerId: z.string().max(60).optional().nullable(),
  receiptEmail: z.string().email().optional().nullable(),
});

export const expenseSchema = z.object({
  description: z.string().trim().min(2).max(240),
  amount: moneyString.refine((v) => Number(v) > 0, "Amount must be positive"),
  categoryId: z.string().uuid().optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  method: z.enum(["cash", "transfer", "card", "cheque", "other"]).default("cash"),
  date: z.string().optional(),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  creditLimit: moneyString.default("0"),
  marketingConsent: z.boolean().default(false),
  whatsappConsent: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20),
  address: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  type: z.enum(["store", "restaurant", "warehouse", "hotel"]).default("store"),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const zJson = <T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ValidationError(first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
  }
  return parsed.data;
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
