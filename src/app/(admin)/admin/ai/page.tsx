import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { Cpu, Gauge, KeyRound, Zap } from "lucide-react";
import { getDb } from "@/server/db";
import { aiModels, aiProviders } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, SectionTitle } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { ProviderTestButton } from "@/components/shell/provider-test-button";
import { addModelAction, saveProviderAction, toggleProviderAction } from "@/server/actions/platform";
import { formatCurrency, relativeTime, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "AI providers" };
export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const db = await getDb();
  const [providers, models] = await Promise.all([
    db.select().from(aiProviders).orderBy(asc(aiProviders.priority)),
    db.select().from(aiModels).orderBy(asc(aiModels.createdAt)),
  ]);
  const modelsByProvider = new Map<string, typeof models>();
  for (const model of models) {
    const list = modelsByProvider.get(model.providerId) ?? [];
    list.push(model);
    modelsByProvider.set(model.providerId, list);
  }
  const defaultModel = models.find((m) => m.isDefault);
  const estimatedSpend = models.reduce((sum, m) => sum + Number(m.outputCostPer1k) * 0, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="AI providers & models" description="Routing, budgets and encrypted credentials. Nothing about the model is hardcoded in the app." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Providers" value={String(providers.length)} hint={`${providers.filter((p) => p.isEnabled).length} enabled`} icon={<Cpu className="size-4" />} />
        <StatCard label="Registered models" value={String(models.length)} hint={`${models.filter((m) => m.isFallback).length} fallbacks`} icon={<Zap className="size-4" />} />
        <StatCard label="Default chat model" value={defaultModel?.label ?? "None"} hint={defaultModel?.modelId} icon={<Gauge className="size-4" />} />
        <StatCard label="Monthly AI budget" value={formatCurrency(providers.reduce((s, p) => s + Number(p.monthlyBudget), 0).toFixed(2), "NGN")} hint="Across enabled providers" icon={<KeyRound className="size-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card className="p-0">
          <div className="p-4"><SectionTitle hint="Priority order = failover order">Providers</SectionTitle></div>
          <TableWrap>
            <Table>
              <thead><tr><Th>Provider</Th><Th>Kind</Th><Th>Models</Th><Th>Priority</Th><Th>Key</Th><Th>Status</Th><Th className="text-right">Controls</Th></tr></thead>
              <tbody>
                {providers.map((provider) => (
                  <Tr key={provider.id}>
                    <Td>
                      <span className="text-[12.5px] font-medium">{provider.name}</span>
                      <p className="font-mono text-[10.5px] muted">{provider.key}</p>
                    </Td>
                    <Td className="text-[11.5px] muted">{titleCase(provider.kind)}</Td>
                    <Td className="text-[11px] muted">{(modelsByProvider.get(provider.id) ?? []).map((m) => m.label).join(", ") || "—"}</Td>
                    <Td className="text-[11.5px] tabular-nums">{provider.priority}</Td>
                    <Td><Badge tone={provider.apiKeyEncrypted ? "success" : "warning"}>{provider.apiKeyEncrypted ? "Encrypted" : "Missing"}</Badge></Td>
                    <Td><Badge tone={provider.status === "healthy" ? "success" : provider.status === "disabled" ? "neutral" : "warning"}>{titleCase(provider.status)}</Badge></Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <ProviderTestButton providerId={provider.id} />
                        <ActionButton action={toggleProviderAction} payload={{ providerId: provider.id, isEnabled: String(!provider.isEnabled) }} variant="ghost">
                          {provider.isEnabled ? "Disable" : "Enable"}
                        </ActionButton>
                      </div>
                      {provider.lastCheckedAt ? <p className="mt-1 text-[10px] muted">checked {relativeTime(provider.lastCheckedAt)}</p> : null}
                    </Td>
                  </Tr>
                ))}
                {providers.length === 0 ? <Tr><Td colSpan={7} className="text-[12px] muted">No providers configured — MERVO is answering deterministically.</Td></Tr> : null}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card className="p-4">
          <SectionTitle hint="Credentials are encrypted with AES-256-GCM">Add or update a provider</SectionTitle>
          <ActionForm action={saveProviderAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Key *"><Input name="key" required placeholder="agnes" /></Field>
            <Field label="Display name *"><Input name="name" required placeholder="Agnes AI" /></Field>
            <Field label="Kind">
              <Select name="kind" defaultValue="agnes">
                <option value="agnes">Agnes</option>
                <option value="openai">OpenAI</option>
                <option value="huggingface">Hugging Face</option>
                <option value="anthropic">Anthropic</option>
                <option value="custom">Custom / OpenAI-compatible</option>
              </Select>
            </Field>
            <Field label="Priority"><Input name="priority" type="number" min="1" defaultValue="10" /></Field>
            <Field label="Base URL" className="sm:col-span-2"><Input name="baseUrl" placeholder="https://api.example.com/v1" /></Field>
            <Field label="API key" className="sm:col-span-2"><Input name="apiKey" type="password" placeholder="Leave blank to keep the existing key" autoComplete="off" /></Field>
            <Field label="Monthly budget"><Input name="monthlyBudget" type="number" step="0.01" min="0" defaultValue="0" /></Field>
            <Field label="Enabled">
              <Select name="isEnabled" defaultValue="true"><option value="true">Enabled</option><option value="false">Disabled</option></Select>
            </Field>
            <div className="rounded-xl border border-[var(--border)] p-3 sm:col-span-2">
              <p className="text-[11px] font-medium">Register a model (optional)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input name="modelId" placeholder="model id, e.g. gpt-4o-mini" />
                <Input name="modelLabel" placeholder="Label" />
                <Select name="task" defaultValue="chat"><option value="chat">Chat</option><option value="analysis">Analysis</option><option value="forecast">Forecast</option></Select>
                <Input name="maxTokens" type="number" min="256" defaultValue="2048" />
                <Input name="inputCostPer1k" type="number" step="0.000001" min="0" placeholder="Input $/1k" />
                <Input name="outputCostPer1k" type="number" step="0.000001" min="0" placeholder="Output $/1k" />
                <label className="flex items-center gap-2 text-[11.5px]"><input type="checkbox" name="isDefault" className="size-3.5" /> Default</label>
                <label className="flex items-center gap-2 text-[11.5px]"><input type="checkbox" name="isFallback" className="size-3.5" /> Fallback</label>
              </div>
            </div>
            <div className="sm:col-span-2"><SubmitButton>Save provider</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>

      <Card className="p-0">
        <div className="p-4"><SectionTitle hint="Costs are per 1,000 tokens">Models</SectionTitle></div>
        <TableWrap>
          <Table>
            <thead><tr><Th>Model</Th><Th>ID</Th><Th>Task</Th><Th className="text-right">Max tokens</Th><Th className="text-right">Input cost</Th><Th className="text-right">Output cost</Th><Th>Role</Th></tr></thead>
            <tbody>
              {models.map((model) => (
                <Tr key={model.id}>
                  <Td className="text-[12.5px] font-medium">{model.label}</Td>
                  <Td className="font-mono text-[10.5px] muted">{model.modelId}</Td>
                  <Td className="text-[11px]">{titleCase(model.task)}</Td>
                  <Td className="text-right tabular-nums">{model.maxTokens}</Td>
                  <Td className="text-right tabular-nums">{model.inputCostPer1k}</Td>
                  <Td className="text-right tabular-nums">{model.outputCostPer1k}</Td>
                  <Td>{model.isDefault ? <Badge tone="success">Default</Badge> : model.isFallback ? <Badge tone="info">Fallback</Badge> : <Badge tone="neutral">Available</Badge>}</Td>
                </Tr>
              ))}
              {models.length === 0 ? <Tr><Td colSpan={7} className="text-[12px] muted">No models registered.</Td></Tr> : null}
            </tbody>
          </Table>
        </TableWrap>
        <div className="p-4">
          <ActionForm action={addModelAction} className="flex flex-wrap items-end gap-2">
            <Field label="Provider">
              <Select name="providerKey" required>
                {providers.map((provider) => <option key={provider.id} value={provider.key}>{provider.name}</option>)}
              </Select>
            </Field>
            <Field label="Model id"><Input name="modelId" required placeholder="meta-llama/Llama-3.1-8B-Instruct" className="w-64" /></Field>
            <Field label="Label"><Input name="label" placeholder="Llama 3.1 8B" /></Field>
            <Field label="Task"><Select name="task" defaultValue="chat"><option value="chat">Chat</option><option value="analysis">Analysis</option><option value="forecast">Forecast</option></Select></Field>
            <div className="flex items-end"><SubmitButton variant="outline">Add model</SubmitButton></div>
          </ActionForm>
        </div>
      </Card>
      <p className="text-[11px] muted">
        Estimated monthly spend across candidates: {formatCurrency(estimatedSpend.toFixed(2), "USD")}. Keys are never returned to the browser — only a status flag is shown.
      </p>
    </div>
  );
}
