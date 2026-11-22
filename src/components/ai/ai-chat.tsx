"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/misc";

type Message = { role: "user" | "assistant"; content: string; tools?: string[]; provider?: string; basis?: string };

const SUGGESTIONS = [
  "How much did I sell this week and how does it compare with last week?",
  "Which products are running out and what should I reorder?",
  "What is my profit after expenses this month?",
  "Which customers are at risk of churning?",
  "Forecast next month's revenue.",
  "Which branch is performing best?",
];

export function AiChat({ greeting, suggestions = SUGGESTIONS }: { greeting: string; suggestions?: string[] }) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const history = messages.filter((m) => m.role !== "assistant" || m.content !== greeting).slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, conversationId, history }),
      });
      const payload = (await response.json()) as { ok?: boolean; data?: { answer: string; conversationId: string; toolsUsed?: string[]; provider?: string; mode?: string }; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "The assistant could not answer that.");
      setConversationId(payload.data.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: payload.data!.answer, tools: payload.data!.toolsUsed, provider: payload.data!.provider, basis: payload.data!.mode },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      toast.error(message);
      setMessages((prev) => [...prev, { role: "assistant", content: `I could not complete that: ${message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-230px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {messages.map((message, index) => (
          <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                message.role === "user" ? "bg-charcoal text-white dark:bg-white dark:text-charcoal" : "border border-[var(--border)] bg-[var(--bg)]",
              )}
            >
              {message.role === "assistant" ? (
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Sparkles className="size-3.5 text-brand" />
                  {message.provider ? <Badge tone={message.basis === "deterministic" ? "neutral" : "success"}>{message.basis === "deterministic" ? "Deterministic data" : message.provider}</Badge> : null}
                  {message.tools?.length ? (
                    <span className="inline-flex items-center gap-1 text-[10px] muted" title={message.tools.join(", ")}>
                      <Wrench className="size-3" /> {message.tools.length} tool{message.tools.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-[12px] muted">
            <Loader2 className="size-3.5 animate-spin" /> Querying your data with verified tools…
          </div>
        ) : null}
      </div>

      {messages.length <= 1 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] px-4 py-3">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void send(suggestion)}
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] transition-colors hover:border-brand hover:text-brand"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-[var(--border)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask about sales, profit, stock, customers or branches…"
          className="min-h-[44px] resize-none text-[13px]"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send question">
          <ArrowUp className="size-4" />
        </Button>
      </form>
    </div>
  );
}
