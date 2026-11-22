import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { branches, roles } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { SectionTitle } from "@/components/ui/page";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { inviteMemberAction, toggleMemberStatusAction, updateMemberRoleAction } from "@/server/actions/team";
import { listTeam } from "@/server/services/tenants";
import { MemberRoleForm } from "@/components/shell/member-role-form";
import { relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Team & roles" };
export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [team, roleRows, branchRows] = await Promise.all([
    listTeam(db, auth.tenantId),
    db.select().from(roles).where(eq(roles.tenantId, auth.tenantId)).orderBy(roles.name),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, auth.tenantId)),
  ]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionTitle hint="They receive a join link and are assigned a role">Invite a team member</SectionTitle>
        <ActionForm action={inviteMemberAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Full name *"><Input name="name" required /></Field>
          <Field label="Email *"><Input name="email" type="email" required /></Field>
          <Field label="Role">
            <Select name="roleKey" defaultValue="cashier">
              {roleRows.map((role) => <option key={role.id} value={role.key}>{role.name}</option>)}
            </Select>
          </Field>
          <Field label="Branch">
            <Select name="branchId" defaultValue="">
              <option value="">All branches</option>
              {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <div className="flex items-end"><SubmitButton>Send invite</SubmitButton></div>
        </ActionForm>
      </Card>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint={`${team.length} members`}>Team</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Member</Th><Th>Role</Th><Th>Branch</Th><Th>Joined</Th><Th>Status</Th><Th className="text-right">Controls</Th></tr></thead>
            <tbody>
              {team.map((member) => (
                <Tr key={member.membershipId}>
                  <Td>
                    <span className="text-[12.5px] font-medium">{member.name}</span>
                    <p className="text-[10.5px] muted">{member.email}</p>
                  </Td>
                  <Td>
                    <MemberRoleForm
                      membershipId={member.membershipId}
                      roleKey={member.roleKey}
                      roles={roleRows.map((role) => ({ key: role.key, name: role.name }))}
                      action={updateMemberRoleAction}
                    />
                  </Td>
                  <Td className="text-[11px] muted">{branchRows.find((b) => b.id === member.branchId)?.name ?? "All branches"}</Td>
                  <Td className="text-[11px] muted">{relativeTime(member.createdAt)}</Td>
                  <Td><Badge tone={member.status === "active" ? "success" : member.status === "invited" ? "warning" : "danger"}>{titleCase(member.status)}</Badge></Td>
                  <Td className="text-right">
                    <ActionButton
                      action={toggleMemberStatusAction}
                      payload={{ membershipId: member.membershipId, status: member.status }}
                      variant={member.status === "active" ? "ghost" : "outline"}
                      confirm={member.status === "active" ? `Disable ${member.name}? Their sessions will be revoked.` : undefined}
                    >
                      {member.status === "active" ? "Disable" : "Activate"}
                    </ActionButton>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint="Granular permission sets">Roles</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Role</Th><Th>Key</Th><Th>Permissions</Th><Th>Scope</Th></tr></thead>
            <tbody>
              {roleRows.map((role) => (
                <Tr key={role.id}>
                  <Td className="text-[12.5px] font-medium">{role.name}</Td>
                  <Td className="font-mono text-[11px] muted">{role.key}</Td>
                  <Td className="text-[11px] muted">{role.permissions.includes("*") ? "All permissions" : `${role.permissions.length} permissions`}</Td>
                  <Td><Badge tone={role.isSystem ? "neutral" : "info"}>{role.isSystem ? "System" : "Custom"}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
