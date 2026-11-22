import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Fingerprint, KeyRound, Laptop, LockKeyhole, ShieldCheck } from "lucide-react";
import { getDb } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { SectionTitle } from "@/components/ui/page";
import { ActionButton } from "@/components/ui/action-form";
import { MfaPanel } from "@/components/shell/mfa-panel";
import { disableMfaAction, signOutOtherSessionsAction } from "@/server/actions/team";
import { dateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const auth = await getAuth();
  if (!auth) return null;
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
  const activeSessions = await db
    .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, lastSeenAt: sessions.lastSeenAt, createdAt: sessions.createdAt, revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.userId, auth.user.id))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(10);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card className="p-4">
          <SectionTitle hint="Time-based one-time passwords">Two-factor authentication</SectionTitle>
          <div className="mt-3 flex items-center gap-2">
            <Badge tone={user?.mfaEnabled ? "success" : "warning"}>{user?.mfaEnabled ? "Enabled" : "Not enabled"}</Badge>
            <span className="text-[11.5px] muted">Protects sign-in with an authenticator app.</span>
          </div>
          <div className="mt-4">
            <MfaPanel enabled={Boolean(user?.mfaEnabled)} />
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle hint="Account">Email & password</SectionTitle>
          <dl className="mt-3 space-y-2 text-[12px]">
            <div className="flex items-center justify-between"><dt className="muted">Email</dt><dd className="font-medium">{user?.email}</dd></div>
            <div className="flex items-center justify-between"><dt className="muted">Email verified</dt><dd><Badge tone={user?.emailVerifiedAt ? "success" : "warning"}>{user?.emailVerifiedAt ? "Verified" : "Pending"}</Badge></dd></div>
            <div className="flex items-center justify-between"><dt className="muted">Password hashing</dt><dd className="inline-flex items-center gap-1"><LockKeyhole className="size-3.5 text-brand" /> scrypt (salt per user)</dd></div>
            <div className="flex items-center justify-between"><dt className="muted">Session cookie</dt><dd>HttpOnly · SameSite=Lax · hashed token</dd></div>
            <div className="flex items-center justify-between"><dt className="muted">Sign-in lockout</dt><dd>5 failed attempts · 15 minutes</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton action={signOutOtherSessionsAction} variant="outline" confirm="Sign out of every other device?">
              <Laptop className="size-3.5" /> Sign out other sessions
            </ActionButton>
            {user?.mfaEnabled ? (
              <ActionButton action={disableMfaAction} variant="ghost" confirm="Disable two-factor authentication? This weakens account security.">
                Disable 2FA
              </ActionButton>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint="Most recent first">Devices & sessions</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Device</Th><Th>IP</Th><Th>Signed in</Th><Th>Last seen</Th><Th>Status</Th></tr></thead>
            <tbody>
              {activeSessions.map((session) => (
                <Tr key={session.id}>
                  <Td className="max-w-[280px] truncate text-[11.5px]">{session.userAgent ?? "Unknown device"}</Td>
                  <Td className="font-mono text-[11px] muted">{session.ip ?? "—"}</Td>
                  <Td className="text-[11px] muted">{relativeTime(session.createdAt)}</Td>
                  <Td className="text-[11px] muted">{dateTime(session.lastSeenAt)}</Td>
                  <Td><Badge tone={session.revokedAt ? "danger" : "success"}>{session.revokedAt ? "Revoked" : "Active"}</Badge></Td>
                </Tr>
              ))}
              {activeSessions.length === 0 ? <Tr><Td colSpan={5} className="text-[12px] muted">No sessions recorded.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <Fingerprint className="size-4 text-brand" />
          <p className="mt-2 text-[12.5px] font-medium">Granular permissions</p>
          <p className="mt-1 text-[11.5px] muted">Every action checks a named permission server-side; the UI only hides what the server already blocks.</p>
        </Card>
        <Card className="p-4">
          <KeyRound className="size-4 text-brand" />
          <p className="mt-2 text-[12.5px] font-medium">Encrypted secrets</p>
          <p className="mt-1 text-[11.5px] muted">Provider keys and TOTP secrets are encrypted with AES-256-GCM using a server-only key.</p>
        </Card>
        <Card className="p-4">
          <ShieldCheck className="size-4 text-brand" />
          <p className="mt-2 text-[12.5px] font-medium">Rate limited</p>
          <p className="mt-1 text-[11.5px] muted">Login, checkout and AI endpoints are throttled per identity and IP.</p>
        </Card>
      </div>
    </div>
  );
}
