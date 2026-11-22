export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type CompletionResult = {
  content: string;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string;
};

export type ProviderCredentials = {
  apiKey: string | null;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
};

export type CompletionRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens: number;
  temperature: number;
};

export interface AIAdapter {
  readonly kind: string;
  complete(creds: ProviderCredentials, request: CompletionRequest): Promise<CompletionResult>;
  test(creds: ProviderCredentials, model: string): Promise<{ ok: boolean; latencyMs: number; error?: string; modelEcho?: string }>;
}

export class AIProviderError extends Error {
  constructor(message: string, public readonly provider?: string, public readonly status?: number) {
    super(message);
    this.name = "AIProviderError";
  }
}

export class AIQuotaExceededError extends Error {
  constructor(public readonly used: number, public readonly limit: number) {
    super(`AI quota reached (${used}/${limit} tokens this period). Upgrade your plan to continue with the assistant.`);
    this.name = "AIQuotaExceededError";
  }
}
