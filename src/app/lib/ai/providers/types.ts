import type { GoModel, ReasoningEffort } from "../models";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCallParams {
  model: GoModel;
  messages: ChatMessage[];
  sessionId: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  jsonMode?: boolean;
  /** Aborts every request of this call, including provider retries. */
  signal?: AbortSignal;
}

export interface ModelCallResult {
  content: string;
  finishReason: string | null;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export type Provider = (params: ModelCallParams) => Promise<ModelCallResult>;
