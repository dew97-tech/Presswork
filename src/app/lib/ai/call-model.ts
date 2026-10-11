import { getModel, type GoEndpoint, type ReasoningEffort } from "./models";
import { chatProvider } from "./providers/chat";
import { messagesProvider } from "./providers/messages";
import { responsesProvider } from "./providers/responses";
import type {
  ChatMessage,
  ModelCallResult,
  Provider,
} from "./providers/types";

const PROVIDERS: Record<GoEndpoint, Provider> = {
  chat: chatProvider,
  responses: responsesProvider,
  messages: messagesProvider,
};

export interface CallModelParams {
  modelId: string;
  messages: ChatMessage[];
  sessionId: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  jsonMode?: boolean;
}

export async function callModel(
  params: CallModelParams,
): Promise<ModelCallResult> {
  const model = getModel(params.modelId);
  if (!model) {
    throw new Error(`Unknown OpenCode Go model "${params.modelId}"`);
  }

  return PROVIDERS[model.endpoint]({ ...params, model });
}

export type { ChatMessage, ModelCallResult } from "./providers/types";
