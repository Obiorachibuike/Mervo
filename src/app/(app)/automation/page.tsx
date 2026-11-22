import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { Bell, Bot, Mail, PlayCircle, Webhook, Zap } from "lucide-react";
import { getDb } from "@/server/db";
import { automationRuns, businesses } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat";
import { Disclosure, PageBody, SectionTitle } from "@/components/ui/page";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { createAutomationAction, runAutomationNowAction, toggleAutomationAction } from "@/server/actions/ops";
import { AUTOMATION_TEMPLATES, listRules, runHistory } from "@/server/services/automation";
import { relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

const ACTION_ICON = { notify: Bell, email: Mail, report: Zap, restock_suggestion: Bot, create_po: Zap, webhook: Webhook } as const;

export default async function AutomationPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [rules, history, recentRuns] = await Promise.all([
    listRules(db, auth.tenantId),
    runHistory(db, auth.tenantId),
    db.select({ id: automationRuns.id, status: automationRuns.status, startedAt: automationRuns.startedAt }).from(automationRuns).where(and(eq(automationRuns.tenantId, auth.tenantId))).orderBy(desc(automationRuns.startedAt)).limit(40),
  ]);
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const active = rules.filter((r) => r.isActive).length;
  const failures = history.filter((h) => h.run.status === "failed").length;

  return (
    <>
      <Topbar title="Automation" subtitle="Rules that watch your business and act without being asked" />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Rules" value={String(rules.length)} hint={`${active} active`} icon={<Zap className="size-4" />} />
          <StatCard label="Runs recorded" value={String(recentRuns.length)} hint="Last 40 executions" icon={<PlayCircle className="size-4" />} />
          <StatCard label="Failures" value={String(failures)} hint="Review and retry" tone={failures ? "warning" : "default"} />
          <StatCard label="Workspace" value={business?.name ?? "—"} hint={business?.industry ? titleCase(business.industry) : undefined} />
        </div>

        <Disclosure title="Create an automation" description="Start from a proven template, then tune the trigger." cta="New rule" defaultOpen={rules.length === 0}>
          <ActionForm action={createAutomationAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Template *">
              <Select name="template" required>
                {AUTOMATION_TEMPLATES.map((template) => (
                  <option key={template.key} value={template.key}>{template.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Name (optional)"><Input name="name" placeholder="Custom name" /></Field>
            <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
              <input type="checkbox" name="requiresApproval" className="size-4 rounded border-[var(--border)]" />
              Require approval before this rule takes an action
            </label>
            <div className="sm:col-span-2"><SubmitButton>Create automation</SubmitButton></div>
          </ActionForm>
        </Disclosure>

        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Toggle or run immediately">Your automations</SectionTitle></div>
          {rules.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] muted">No automations yet — start with the low-stock alert template above.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead><tr><Th>Rule</Th><Th>Trigger</Th><Th>Action</Th><Th>Last run</Th><Th>Status</Th><Th className="text-right">Controls</Th></tr></thead>
                <tbody>
                  {rules.map((rule) => {
                    const Icon = ACTION_ICON[rule.actionType as keyof typeof ACTION_ICON] ?? Zap;
                    return (
                      <Tr key={rule.id}>
                        <Td>
                          <span className="text-[12.5px] font-medium">{rule.name}</span>
                          <p className="text-[10.5px] muted">{titleCase(rule.triggerType)} · {rule.runCount} runs {rule.requiresApproval ? "· needs approval" : ""}</p>
                        </Td>
                        <Td className="max-w-[180px] text-[11px] muted"><code className="line-clamp-2">{JSON.stringify(rule.triggerConfig)}</code></Td>
                        <Td><span className="inline-flex items-center gap-1 text-[11.5px]"><Icon className="size-3.5 text-brand" />{titleCase(rule.actionType)}</span></Td>
                        <Td className="text-[11px] muted">{rule.lastRunAt ? relativeTime(rule.lastRunAt) : "Never"}</Td>
                        <Td><Badge tone={rule.isActive ? "success" : "neutral"}>{rule.isActive ? "Active" : "Paused"}</Badge></Td>
                        <Td className="text-right">
                          <div className="flex justify-end gap-1">
                            <ActionButton action={toggleAutomationAction} payload={{ ruleId: rule.id, isActive: String(!rule.isActive) }} variant="ghost">
                              {rule.isActive ? "Pause" : "Enable"}
                            </ActionButton>
                            <ActionButton action={runAutomationNowAction} payload={{ ruleId: rule.id }} variant="outline">Run now</ActionButton>
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Newest first">Run history</SectionTitle></div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Rule</Th><Th>Started</Th><Th>Status</Th><Th>Output</Th></tr></thead>
              <tbody>
                {history.map(({ run, ruleName }) => (
                  <Tr key={run.id}>
                    <Td className="text-[12px]">{ruleName}</Td>
                    <Td className="text-[11px] muted">{relativeTime(run.startedAt)}</Td>
                    <Td><Badge tone={run.status === "success" ? "success" : run.status === "failed" ? "danger" : "warning"}>{titleCase(run.status)}</Badge></Td>
                    <Td className="max-w-[420px] truncate text-[11px] muted">{run.output ?? "—"}</Td>
                  </Tr>
                ))}
                {history.length === 0 ? <Tr><Td colSpan={4} className="text-[12px] muted">No runs yet. Hit “Run now” on a rule to test it.</Td></Tr> : null}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card className="p-4 text-[11.5px] muted">
          <p>
            Automations run on the background job queue (pg-boss style, Postgres-backed with <code className="text-[10px]">FOR UPDATE SKIP LOCKED</code>), so they
            keep working without a separate worker service. Serverless deployments drain the queue through the scheduled cron endpoint.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
