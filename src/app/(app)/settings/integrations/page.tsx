import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { Cloud, CreditCard, Cpu, Mail, Webhook } from "lucide-react";
import { getDb } from "@/server/db";
import { webhookEvents } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { SectionTitle } from "@/components/ui/page";
import { dateTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const auth = await getAuth();
  if (!auth) return null;
  const db = await getDb();
  const events = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(15);

  const integrations = [
    { name: "Paystack", kind: "Payments", icon: CreditCard, configured: Boolean(process.env.PAYSTACK_SECRET_KEY), detail: "Card, transfer and USSD collection for Nigeria." },
    { name: "Flutterwave", kind: "Payments", icon: CreditCard, configured: Boolean(process.env.FLUTTERWAVE_SECRET_KEY), detail: "Multi-currency African payment gateway." },
    { name: "Stripe", kind: "Payments", icon: CreditCard, configured: Boolean(process.env.STRIPE_SECRET_KEY), detail: "Global card payments and subscriptions." },
    { name: "Agnes AI", kind: "AI", icon: Cpu, configured: Boolean(process.env.AGNES_API_KEY), detail: "Primary conversational model for MERVO answers." },
    { name: "OpenAI", kind: "AI", icon: Cpu, configured: Boolean(process.env.OPENAI_API_KEY), detail: "Fallback and analysis model." },
    { name: "Hugging Face", kind: "AI", icon: Cpu, configured: Boolean(process.env.HF_TOKEN), detail: "Open-weight models for cost-effective inference." },
    { name: "Cloudinary", kind: "Media", icon: Cloud, configured: Boolean(process.env.CLOUDINARY_API_KEY), detail: "Product images and storefront banners." },
    { name: "Email delivery", kind: "Messaging", icon: Mail, configured: Boolean(process.env.SMTP_HOST ?? process.env.RESEND_API_KEY), detail: "Receipts, invitations and digests." },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {integrations.map((integration) => (
          <Card key={integration.name} className="p-4">
            <div className="flex items-start justify-between">
              <integration.icon className="size-4 text-brand" />
              <Badge tone={integration.configured ? "success" : "warning"}>{integration.configured ? "Connected" : "Not configured"}</Badge>
            </div>
            <p className="mt-2 text-[12.5px] font-medium">{integration.name}</p>
            <p className="text-[10.5px] uppercase tracking-wide muted">{integration.kind}</p>
            <p className="mt-1.5 text-[11px] muted">{integration.detail}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <SectionTitle hint="Server environment variables">How keys are managed</SectionTitle>
        <p className="mt-2 text-[11.5px] leading-relaxed muted">
          Provider credentials live in server-side environment variables and are never exposed to the browser. AI provider keys are encrypted at rest with
          AES-256-GCM. Ask a platform administrator to rotate a key if you suspect exposure — rotation takes effect immediately, without a deploy.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10.5px]">
          {["PAYSTACK_SECRET_KEY", "PAYSTACK_WEBHOOK_SECRET", "FLUTTERWAVE_SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "AGNES_API_KEY", "OPENAI_API_KEY", "HF_TOKEN", "CLOUDINARY_API_KEY"].map((name) => (
            <code key={name} className="rounded bg-black/5 px-1.5 py-1 dark:bg-white/10">{name}</code>
          ))}
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] muted"><Webhook className="size-3.5" /> Webhook endpoints: <code className="text-[10.5px]">/api/webhooks/paystack</code> · <code className="text-[10.5px]">/api/webhooks/flutterwave</code> · <code className="text-[10.5px]">/api/webhooks/stripe</code></p>
      </Card>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint="Signature verified">Recent webhook traffic</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Received</Th><Th>Gateway</Th><Th>Event</Th><Th>Signature</Th><Th>Status</Th></tr></thead>
            <tbody>
              {events.map((event) => (
                <Tr key={event.id}>
                  <Td className="whitespace-nowrap text-[11px] muted">{dateTime(event.receivedAt)}</Td>
                  <Td className="text-[11.5px]">{event.source}</Td>
                  <Td className="font-mono text-[10.5px]">{event.eventId}</Td>
                  <Td><Badge tone={event.signatureValid ? "success" : "danger"}>{event.signatureValid ? "Valid" : "Invalid"}</Badge></Td>
                  <Td><Badge tone={event.status === "processed" ? "success" : event.status === "failed" ? "danger" : "warning"}>{titleCase(event.status)}</Badge></Td>
                </Tr>
              ))}
              {events.length === 0 ? <Tr><Td colSpan={5} className="text-[12px] muted">No webhook events received yet.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
