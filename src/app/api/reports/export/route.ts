import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { rangeFromDays, salesByDay, topProducts } from "@/server/services/reports";
import { lowStockItems } from "@/server/services/inventory";
import { branches } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(request: Request) {
  const auth = await getAuth();
  if (!auth?.tenantId) return new Response("Unauthorised", { status: 401 });
  if (!hasPermission(auth.rawPermissions, "reports.export") && !hasPermission(auth.rawPermissions, "reports.view")) {
    return new Response("Forbidden", { status: 403 });
  }
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
  const range = rangeFromDays(days);
  const db = await getDb();
  const [daily, products, [branch]] = await Promise.all([
    salesByDay(db, auth.tenantId, range),
    topProducts(db, auth.tenantId, range, 100),
    db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, auth.tenantId)).limit(1),
  ]);
  const low = branch ? await lowStockItems(db, auth.tenantId, branch.id) : [];

  const lines: string[] = [];
  lines.push(`MERVO export,${auth.tenant?.name ?? "Workspace"},${range.from.toISOString()},${range.to.toISOString()}`);
  lines.push("");
  lines.push("Daily sales");
  lines.push("Date,Gross sales");
  for (const row of daily) lines.push(`${csvCell(row.day)},${csvCell(row.total)}`);
  lines.push("");
  lines.push("Top products");
  lines.push("Product,Units,Revenue");
  for (const row of products) lines.push(`${csvCell(row.name)},${csvCell(row.units)},${csvCell(row.revenue)}`);
  lines.push("");
  lines.push("Low stock");
  lines.push("Product,SKU,On hand,Reorder point");
  for (const row of low) lines.push(`${csvCell(row.name)},${csvCell(row.sku)},${csvCell(row.quantity)},${csvCell(row.reorderPoint)}`);

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="mervo-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
