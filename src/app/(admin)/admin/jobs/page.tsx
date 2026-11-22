import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { RefreshCw, Timer } from "lucide-react";
import { getDb } from "@/server/db";
import { jobQueue } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { enqueueJobAction, retryJobsAction } from "@/server/actions/platform";
import { queueStats } from "@/server/jobs/queue";
import { relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const HANDLERS = ["generate-insights", "run-automations", "refresh-customer-segments", "expire-trials", "daily-digest", "retry-failed-webhooks"] as const;

export default async function AdminJobsPage() {
  const db = await getDb();
  const [stats, recent] = await Promise.all([
    queueStats(db),
    db.select().from(jobQueue).orderBy(desc(jobQueue.createdAt)).limit(40),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Job monitor" description="Postgres-backed queue with row-level locking. The worker runs outside serverless; cron drains queued work." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queued" value={String(stats.byStatus.queued ?? 0)} hint="Waiting for a worker" icon={<Timer className="size-4" />} />
        <StatCard label="Active" value={String(stats.byStatus.active ?? 0)} hint="Locked by a worker" />
        <StatCard label="Completed" value={String(stats.byStatus.completed ?? 0)} tone="positive" />
        <StatCard label="Failed" value={String(stats.byStatus.failed ?? 0)} tone={(stats.byStatus.failed ?? 0) > 0 ? "critical" : "default"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-0">
          <div className="flex items-center justify-between p-4">
            <SectionTitle hint="Newest first">Queue</SectionTitle>
            <ActionButton action={retryJobsAction} variant="outline">
              <RefreshCw className="size-3.5" /> Requeue failures
            </ActionButton>
          </div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Job</Th><Th>Status</Th><Th className="text-right">Attempts</Th><Th>Run at</Th><Th>Last error</Th></tr></thead>
              <tbody>
                {recent.map((job) => (
                  <Tr key={job.id}>
                    <Td>
                      <span className="font-mono text-[11px]">{job.name}</span>
                      <p className="text-[10px] muted">{job.tenantId ? job.tenantId.slice(0, 8) : "platform"} · {relativeTime(job.createdAt)}</p>
                    </Td>
                    <Td><Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : job.status === "active" ? "info" : "neutral"}>{titleCase(job.status)}</Badge></Td>
                    <Td className="text-right tabular-nums">{job.attempts}/{job.maxAttempts}</Td>
                    <Td className="text-[11px] muted">{relativeTime(job.runAt)}</Td>
                    <Td className="max-w-[240px] truncate text-[10.5px] text-red-600">{job.lastError ?? "—"}</Td>
                  </Tr>
                ))}
                {recent.length === 0 ? <Tr><Td colSpan={5} className="text-[12px] muted">Queue is empty.</Td></Tr> : null}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card className="p-4">
          <SectionTitle hint="Runs asynchronously">Enqueue a job</SectionTitle>
          <ActionForm action={enqueueJobAction} className="mt-3 space-y-3">
            <Field label="Handler">
              <Select name="name" required>
                {HANDLERS.map((handler) => <option key={handler} value={handler}>{handler}</option>)}
              </Select>
            </Field>
            <Field label="Tenant id (optional)"><Input name="tenantId" placeholder="Leave blank for platform-wide" /></Field>
            <SubmitButton>Queue job</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-[11px] leading-relaxed muted">
            Local: run <code className="text-[10px]">npm run worker</code>. Vercel: scheduled <code className="text-[10px]">/api/cron/run</code> with{" "}
            <code className="text-[10px]">CRON_SECRET</code>. No Redis or RabbitMQ required.
          </p>
        </Card>
      </div>
    </div>
  );
}
