import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, gte, sql } from "drizzle-orm";
import { Activity, Building2, Cpu, Users, Wallet } from "lucide-react";
import { getDb } from "@/server/db";
import { aiInsights, auditLogs, memberships, sales, subscriptions, tenants, users } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, SectionTitle } from "@/components/ui/page";
import { platformBillingStats } from "@/server/services/subscriptions";
import { queueStats } from "@/server/jobs/queue";
import { formatCurrency, formatNumber, relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Platform overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const db = await getDb();
  const [billing, jobs] = await Promise.all([platformBillingStats(db), queueStats(db)]);
  const [counts] = await db.select({ tenants: sql<number>`count(*)::int`, trialing: sql<number>`sum(case when status = 'trialing' then 1 else 0 end)::int`, suspended: sql<number>`sum(case when status = 'suspended' then 1 else 0 end)::int` }).from(tenants);
  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const [memberCount] = await db.select({ count: sql<number>`count(*)::int` }).from(memberships);
  const [insightCount] = await db.select({ count: sql<number>`count(*)::int` }).from(aiInsights);
  const [gmv] = await db.select({ total: sql<string>`coalesce(sum(total), 0)::text` }).from(sales).where(gte(sales.createdAt, new Date(Date.now() - 30 * 86400000)));
  const recentTenants = await db
    .select({ tenant: tenants, plan: subscriptions.planId })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .orderBy(desc(tenants.createdAt))
    .limit(8);
  const criticalEvents = await db.select().from(auditLogs).where(eq(auditLogs.severity, "critical")).orderBy(desc(auditLogs.createdAt)).limit(6);

  return (
    <div className="space-y-5">
      <PageHeader title="Platform overview" description="Live health of every MERVO workspace, subscription and background job." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Workspaces" value={formatNumber(counts?.tenants ?? 0)} hint={`${counts?.trialing ?? 0} trialing · ${counts?.suspended ?? 0} suspended`} icon={<Building2 className="size-4" />} />
        <StatCard label="Paying subscriptions" value={String(billing.active + billing.pastDue)} hint={`MRR ${formatCurrency(billing.mrr, "NGN")}`} tone="positive" icon={<Wallet className="size-4" />} />
        <StatCard label="Users" value={formatNumber(userCount?.count ?? 0)} hint={`${memberCount?.count ?? 0} memberships`} icon={<Users className="size-4" />} />
        <StatCard label="Platform GMV (30d)" value={formatCurrency(gmv?.total ?? "0", "NGN")} hint={`${formatNumber(insightCount?.count ?? 0)} AI insights generated`} icon={<Activity className="size-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Newest first">Recent workspaces</SectionTitle></div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Workspace</Th><Th>Status</Th><Th>Created</Th><Th className="text-right">Trial ends</Th></tr></thead>
              <tbody>
                {recentTenants.map(({ tenant }) => (
                  <Tr key={tenant.id}>
                    <Td>
                      <Link href={`/admin/tenants?q=${tenant.slug}`} className="text-[12.5px] font-medium hover:text-brand">{tenant.name}</Link>
                      <p className="font-mono text-[10.5px] muted">{tenant.slug}</p>
                    </Td>
                    <Td><Badge tone={tenant.status === "active" ? "success" : tenant.status === "suspended" ? "danger" : "warning"}>{titleCase(tenant.status)}</Badge></Td>
                    <Td className="text-[11px] muted">{relativeTime(tenant.createdAt)}</Td>
                    <Td className="text-right text-[11px] muted">{tenant.trialEndsAt ? relativeTime(tenant.trialEndsAt) : "—"}</Td>
                  </Tr>
                ))}
                {recentTenants.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No workspaces yet.</Td></Tr> : null}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle hint="Background queue">Jobs</SectionTitle>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <Row label="Queued" value={String(jobs.byStatus.queued ?? 0)} />
              <Row label="Active" value={String(jobs.byStatus.active ?? 0)} />
              <Row label="Completed" value={String(jobs.byStatus.completed ?? 0)} />
              <Row label="Failed" value={String(jobs.byStatus.failed ?? 0)} />
            </dl>
            <Link href="/admin/jobs" className="mt-3 inline-block text-[11.5px] font-medium text-brand">Open job monitor</Link>
          </Card>
          <Card className="p-4">
            <SectionTitle hint="Last 6">Critical audit events</SectionTitle>
            <ul className="mt-2 space-y-1.5 text-[11.5px]">
              {criticalEvents.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10.5px]">{event.action}</span>
                  <span className="shrink-0 text-[10px] muted">{relativeTime(event.createdAt)}</span>
                </li>
              ))}
              {criticalEvents.length === 0 ? <li className="muted">Nothing critical logged.</li> : null}
            </ul>
          </Card>
          <Card className="p-4">
            <SectionTitle hint="Read-only">Runtime</SectionTitle>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <Row label="Database" value={process.env.DATABASE_URL ? "Postgres" : "PGlite (embedded)"} />
              <Row label="MRR" value={formatCurrency(billing.mrr, "NGN")} />
              <Row label="Region" value={process.env.VERCEL_REGION ?? "local"} />
            </dl>
            <p className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] muted"><Cpu className="size-3" /> Health endpoint: <code>/api/health</code></p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
