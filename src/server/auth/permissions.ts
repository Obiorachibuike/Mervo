/**
 * Granular permission catalogue + default role definitions.
 * Permissions are stored per role (jsonb string[]), never checked on the client alone.
 */
export const PERMISSIONS = {
  "sales.create": "Process sales at the POS",
  "sales.view": "View sales and receipts",
  "sales.refund": "Issue refunds and returns",
  "sales.void": "Void completed sales",
  "sales.discount": "Apply discounts",
  "inventory.view": "View products and stock",
  "inventory.create": "Create and edit products",
  "inventory.adjust": "Adjust stock levels",
  "inventory.transfer": "Transfer stock between branches",
  "inventory.purchase": "Manage purchase orders and suppliers",
  "customers.view": "View customers",
  "customers.manage": "Create and edit customers",
  "finance.view": "View financial reports",
  "finance.manage": "Record expenses and journal entries",
  "finance.close": "Close financial periods",
  "employees.view": "View employees",
  "employees.manage": "Manage employees and schedules",
  "employees.payroll": "Run payroll",
  "reports.view": "View reports",
  "reports.export": "Export reports",
  "ai.assistant.use": "Use the MERVO AI assistant",
  "automation.manage": "Create automation rules",
  "settings.manage": "Manage business settings",
  "branches.manage": "Manage branches",
  "billing.manage": "Manage subscription and billing",
  "audit.view": "View audit logs",
  "restaurant.manage": "Manage tables, menus and kitchen orders",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleKey =
  | "super_admin"
  | "owner"
  | "admin"
  | "branch_manager"
  | "accountant"
  | "inventory_manager"
  | "cashier"
  | "sales_rep"
  | "restaurant_manager"
  | "kitchen_staff"
  | "auditor";

export type RoleDefinition = { key: RoleKey; name: string; description: string; permissions: Permission[] | ["*"] };

const ALL: Permission[] = ALL_PERMISSIONS;

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  { key: "super_admin", name: "Super Admin", description: "MERVO platform operator (cross-tenant)", permissions: ["*"] },
  { key: "owner", name: "Business Owner", description: "Full control of the business workspace", permissions: ["*"] },
  {
    key: "admin",
    name: "Business Administrator",
    description: "Manages day-to-day operations except billing ownership",
    permissions: ALL.filter((p) => !["billing.manage"].includes(p)),
  },
  {
    key: "branch_manager",
    name: "Branch Manager",
    description: "Runs a single branch",
    permissions: [
      "sales.create", "sales.view", "sales.refund", "sales.discount", "inventory.view", "inventory.adjust",
      "inventory.transfer", "inventory.purchase", "customers.view", "customers.manage", "reports.view",
      "ai.assistant.use", "employees.view", "restaurant.manage", "automation.manage",
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Financial management and reporting",
    permissions: ["finance.view", "finance.manage", "finance.close", "reports.view", "reports.export", "sales.view", "customers.view", "audit.view", "ai.assistant.use", "inventory.view"],
  },
  {
    key: "inventory_manager",
    name: "Inventory Manager",
    description: "Stock, purchasing and suppliers",
    permissions: ["inventory.view", "inventory.create", "inventory.adjust", "inventory.transfer", "inventory.purchase", "reports.view", "ai.assistant.use"],
  },
  {
    key: "cashier",
    name: "Cashier",
    description: "POS selling and receipts",
    permissions: ["sales.create", "sales.view", "customers.view", "customers.manage", "inventory.view"],
  },
  {
    key: "sales_rep",
    name: "Sales Representative",
    description: "Selling and customer relationships",
    permissions: ["sales.create", "sales.view", "sales.discount", "customers.view", "customers.manage", "inventory.view"],
  },
  {
    key: "restaurant_manager",
    name: "Restaurant Manager",
    description: "Restaurant floor, menu and kitchen",
    permissions: ["sales.create", "sales.view", "sales.refund", "sales.discount", "inventory.view", "customers.view", "customers.manage", "restaurant.manage", "reports.view", "ai.assistant.use"],
  },
  {
    key: "kitchen_staff",
    name: "Kitchen Staff",
    description: "Kitchen display and order preparation",
    permissions: ["restaurant.manage", "sales.view", "inventory.view"],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only assurance access",
    permissions: ["sales.view", "finance.view", "inventory.view", "reports.view", "reports.export", "audit.view", "employees.view", "customers.view"],
  },
];

export const roleByKey = (key: string): RoleDefinition | undefined => ROLE_DEFINITIONS.find((r) => r.key === key);

export function resolvePermissions(perms: string[]): Permission[] {
  if (perms.includes("*")) return ALL_PERMISSIONS;
  return perms.filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
}

export function hasPermission(granted: string[], required: Permission | Permission[]): boolean {
  const resolved = new Set(resolvePermissions(granted));
  const needed = Array.isArray(required) ? required : [required];
  return needed.every((p) => resolved.has(p));
}

export class PermissionError extends Error {
  readonly permission: string;
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionError";
    this.permission = permission;
  }
}

export function assertPermission(granted: string[], required: Permission | Permission[]): void {
  if (!hasPermission(granted, required)) {
    const needed = Array.isArray(required) ? required : [required];
    throw new PermissionError(needed.find((p) => !new Set(resolvePermissions(granted)).has(p)) ?? String(required));
  }
}
