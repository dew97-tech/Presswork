import {
  getModel,
  type GoEndpoint,
  type GoModel,
  type ReasoningEffort,
} from "./models";
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
  /**
   * Epoch ms after which the whole call (every provider retry included) is
   * aborted. Lets callers keep model work inside a serverless time budget.
   */
  deadline?: number;
}

function estimateCost(
  model: GoModel,
  result: ModelCallResult,
): number | undefined {
  if (
    model.inputPricePerM === null ||
    model.outputPricePerM === null ||
    result.inputTokens === undefined ||
    result.outputTokens === undefined
  ) {
    return undefined;
  }

  return (
    (result.inputTokens * model.inputPricePerM +
      result.outputTokens * model.outputPricePerM) /
    1_000_000
  );
}

export async function callModel(
  params: CallModelParams,
): Promise<ModelCallResult> {
  const model = getModel(params.modelId);
  if (!model) {
    throw new Error(`Unknown OpenCode Go model "${params.modelId}"`);
  }

  const { deadline, ...rest } = params;
  let signal: AbortSignal | undefined;
  if (deadline !== undefined) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Model call deadline already passed for ${model.id}`);
    }
    signal = AbortSignal.timeout(remainingMs);
  }

  const result = await PROVIDERS[model.endpoint]({ ...rest, model, signal });

  // Only the chat endpoint reports cost; fall back to catalog pricing.
  return result.cost === undefined
    ? { ...result, cost: estimateCost(model, result) }
    : result;
}

export type { ChatMessage, ModelCallResult } from "./providers/types";
