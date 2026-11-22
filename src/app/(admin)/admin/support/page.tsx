import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { supportTickets, tenants } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { ActionButton } from "@/components/ui/action-form";
import { resolveTicketAction } from "@/server/actions/platform";
import { relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const db = await getDb();
  const rows = await db
    .select({ ticket: supportTickets, tenantName: tenants.name })
    .from(supportTickets)
    .leftJoin(tenants, eq(tenants.id, supportTickets.tenantId))
    .orderBy(desc(supportTickets.createdAt))
    .limit(100);

  const open = rows.filter((r) => r.ticket.status === "open").length;
  const urgent = rows.filter((r) => r.ticket.priority === "urgent" || r.ticket.priority === "high").length;

  return (
    <div className="space-y-4">
      <PageHeader title="Support tickets" description="Workspace requests raised from inside MERVO." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open" value={String(open)} tone={open ? "warning" : "default"} />
        <StatCard label="High priority" value={String(urgent)} tone={urgent ? "critical" : "default"} />
        <StatCard label="Total" value={String(rows.length)} />
      </div>
      <Card className="p-0">
        <div className="p-4"><SectionTitle hint="Newest first">Tickets</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Subject</Th><Th>Workspace</Th><Th>Priority</Th><Th>Received</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {rows.map(({ ticket, tenantName }) => (
                <Tr key={ticket.id}>
                  <Td>
                    <span className="text-[12.5px] font-medium">{ticket.subject}</span>
                    <p className="max-w-[320px] truncate text-[10.5px] muted">{ticket.body}</p>
                  </Td>
                  <Td className="text-[11px] muted">{tenantName ?? "Platform"}</Td>
                  <Td><Badge tone={ticket.priority === "urgent" ? "danger" : ticket.priority === "high" ? "warning" : "neutral"}>{titleCase(ticket.priority)}</Badge></Td>
                  <Td className="text-[11px] muted">{relativeTime(ticket.createdAt)}</Td>
                  <Td><Badge tone={ticket.status === "open" ? "warning" : ticket.status === "resolved" ? "success" : "neutral"}>{titleCase(ticket.status)}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {ticket.status !== "resolved" ? (
                        <ActionButton action={resolveTicketAction} payload={{ ticketId: ticket.id, status: "resolved" }} variant="secondary">Resolve</ActionButton>
                      ) : null}
                      {ticket.status !== "closed" ? (
                        <ActionButton action={resolveTicketAction} payload={{ ticketId: ticket.id, status: "closed" }} variant="ghost">Close</ActionButton>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 ? <Tr><Td colSpan={6} className="text-[12px] muted">No support tickets yet.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
