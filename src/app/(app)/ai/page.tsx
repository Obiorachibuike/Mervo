import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { BrainCircuit, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";
import { getDb } from "@/server/db";
import { aiConversations, aiProviders, businesses } from "@/server/db/schema";
import { getAuth } from "@/server/auth/session";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageBody, SectionTitle } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/empty";
import { ActionButton } from "@/components/ui/action-form";
import { AiChat } from "@/components/ai/ai-chat";
import { listInsights } from "@/server/ai/insights";
import { dismissInsightAction, refreshInsightsAction } from "@/server/actions/ops";
import { relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "AI assistant" };
export const dynamic = "force-dynamic";

export default async function AiPage() {
  const auth = await getAuth();
  if (!auth?.tenantId) return null;
  const db = await getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.tenantId, auth.tenantId)).limit(1);
  const currency = business?.currency ?? "NGN";
  const insights = await listInsights(db, auth.tenantId, 8);
  const providers = await db.select().from(aiProviders).where(eq(aiProviders.isEnabled, true));
  const conversations = await db
    .select({ id: aiConversations.id, title: aiConversations.title, createdAt: aiConversations.createdAt })
    .from(aiConversations)
    .where(and(eq(aiConversations.tenantId, auth.tenantId), eq(aiConversations.userId, auth.user.id)))
    .orderBy(aiConversations.createdAt)
    .limit(5);

  const activeProvider = providers.find((p) => p.status === "healthy") ?? providers.sort((a, b) => a.priority - b.priority)[0];
  const greeting = `Hi ${auth.user.name.split(" ")[0]} — I'm MERVO. I answer from your live data using verified SQL tools, so I will never invent a number. Ask me about sales, profit, stock, customers or branches.`;

  return (
    <>
      <Topbar title="Ask MERVO" subtitle="Conversational business intelligence over your real ledger" />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          <div className="space-y-3">
            <AiChat greeting={greeting} />
            <Card className="flex flex-wrap items-center gap-3 p-3 text-[11px] muted">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-brand" /> Tenant-scoped tools only</span>
              <span className="inline-flex items-center gap-1.5"><BrainCircuit className="size-3.5 text-brand" /> Provider: {activeProvider ? `${activeProvider.name}` : "deterministic engine"}</span>
              <span>Model routing is configured by the platform admin — nothing is hardcoded here.</span>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle hint={`${insights.length} open`}>AI insights</SectionTitle>
                <ActionButton action={refreshInsightsAction} variant="outline">Refresh</ActionButton>
              </div>
              {insights.length === 0 ? (
                <p className="mt-3 text-[12px] muted">No insights yet. They are generated from your sales velocity, margins and stock coverage.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {insights.map((insight) => (
                    <li key={insight.id} className="rounded-xl border border-[var(--border)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-medium">{insight.title}</p>
                        <Badge tone={insight.severity === "critical" ? "danger" : insight.severity === "warning" ? "warning" : "success"}>{titleCase(insight.severity)}</Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-relaxed muted">{insight.body}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] muted">{relativeTime(insight.createdAt)} · {titleCase(insight.kind)}</span>
                        <ActionButton action={dismissInsightAction} payload={{ insightId: insight.id }} variant="ghost">Dismiss</ActionButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <SectionTitle hint="Verified tools">What I can compute</SectionTitle>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["get_sales_summary", "get_profit_summary", "get_inventory_status", "get_top_products", "get_customer_insights", "get_branch_performance", "get_expense_summary", "forecast_sales", "recommend_restock", "generate_business_report"].map((tool) => (
                  <code key={tool} className="rounded-md bg-black/5 px-1.5 py-1 text-[10px] dark:bg-white/10">{tool}</code>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed muted">
                Every figure comes back with a basis tag — <code className="text-[10px]">actual</code>, <code className="text-[10px]">estimate</code> or{" "}
                <code className="text-[10px]">recommendation</code> — so forecasts are never presented as booked revenue. Company <span className="font-medium">{currency}</span> is applied throughout.
              </p>
            </Card>

            <Card className="p-4">
              <SectionTitle hint="Your last questions">Recent conversations</SectionTitle>
              {conversations.length === 0 ? (
                <p className="mt-2 text-[11.5px] muted">Your questions are saved here so you can pick up where you left off.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-[12px]">
                  {conversations.map((conversation) => (
                    <li key={conversation.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{conversation.title}</span>
                      <span className="shrink-0 text-[10.5px] muted">{relativeTime(conversation.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/reports" className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand">
                <Lightbulb className="size-3.5" /> See the deterministic reports behind these answers
              </Link>
            </Card>
          </div>
        </div>

        {!activeProvider ? (
          <EmptyState
            title="No AI provider configured"
            description="The assistant is running in deterministic mode: answers are computed by the SQL engine but not narrated by an LLM. A super admin can add an Agnes AI, OpenAI or Hugging Face key."
            icon={<Sparkles className="size-5" />}
          />
        ) : null}
      </PageBody>
    </>
  );
}
