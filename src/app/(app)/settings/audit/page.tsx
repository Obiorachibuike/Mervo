import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { dateTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; severity?: string }> }) {
  const params = await searchParams;
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();

  const conditions = [eq(auditLogs.tenantId, auth.tenantId)];
  if (params.q) conditions.push(sql`(${auditLogs.action} ilike ${`%${params.q}%`} or ${auditLogs.actorEmail} ilike ${`%${params.q}%`})`);
  if (params.severity && params.severity !== "all") conditions.push(eq(auditLogs.severity, params.severity as "info" | "warning" | "critical"));

  const rows = await db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(200);
  const counts = await db
    .select({ severity: auditLogs.severity, count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, auth.tenantId))
    .groupBy(auditLogs.severity);

  const bySeverity = new Map(counts.map((c) => [c.severity, c.count]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Informational" value={String(bySeverity.get("info") ?? 0)} />
        <StatCard label="Warnings" value={String(bySeverity.get("warning") ?? 0)} tone="warning" />
        <StatCard label="Critical" value={String(bySeverity.get("critical") ?? 0)} tone="critical" />
      </div>

      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="mb-1 block text-[11px] font-medium muted">Search</span>
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Action or actor email" />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium muted">Severity</span>
            <Select name="severity" defaultValue={params.severity ?? "all"}>
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </Select>
          </label>
          <Button type="submit">Filter</Button>
        </form>
      </Card>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint="Append-only · last 200 events">Audit trail</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Severity</Th><Th>Details</Th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap text-[11px] muted">{dateTime(row.createdAt)}</Td>
                  <Td className="text-[11.5px]">{row.actorEmail ?? "system"}</Td>
                  <Td className="font-mono text-[11px]">{row.action}</Td>
                  <Td className="text-[11px] muted">{row.entity ?? "—"}{row.entityId ? <p className="font-mono text-[10px]">{row.entityId.slice(0, 8)}…</p> : null}</Td>
                  <Td><Badge tone={row.severity === "critical" ? "danger" : row.severity === "warning" ? "warning" : "neutral"}>{titleCase(row.severity)}</Badge></Td>
                  <Td className="max-w-[320px] truncate text-[10.5px] muted">{JSON.stringify(row.metadata)}</Td>
                </Tr>
              ))}
              {rows.length === 0 ? <Tr><Td colSpan={6} className="text-[12px] muted">No audit events match this filter.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
