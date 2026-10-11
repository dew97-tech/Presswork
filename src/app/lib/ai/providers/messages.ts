import type { ReasoningEffort } from "../models";
import {
  DEFAULT_TIMEOUT_MS,
  goApiKey,
  readErrorBody,
  requireContent,
  sendGoRequest,
} from "./http";
import type { ModelCallResult, Provider } from "./types";

interface MessagesApiResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const THINKING_BUDGETS: Record<Exclude<ReasoningEffort, "none">, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
};

export const messagesProvider: Provider = async ({
  model,
  messages,
  sessionId,
  temperature,
  maxTokens = 6000,
  reasoningEffort,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}): Promise<ModelCallResult> => {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const body: Record<string, unknown> = {
    model: model.id,
    max_tokens: maxTokens,
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    ...(system ? { system } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  if (reasoningEffort && reasoningEffort !== "none") {
    const budget = Math.min(
      THINKING_BUDGETS[reasoningEffort],
      Math.max(1024, Math.floor(maxTokens * 0.4)),
    );
    if (budget < maxTokens) {
      body.thinking = { type: "enabled", budget_tokens: budget };
    }
  }

  const extraHeaders = {
    "x-api-key": goApiKey(),
    "anthropic-version": "2023-06-01",
  };

  let lastErrorText = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await sendGoRequest({
      path: "/messages",
      sessionId,
      timeoutMs,
      body,
      extraHeaders,
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      lastErrorText = errorBody;

      if (response.status === 400) {
        if (body.thinking && /thinking|reasoning/i.test(errorBody)) {
          delete body.thinking;
          continue;
        }
        if (body.temperature !== undefined && /temperature/i.test(errorBody)) {
          delete body.temperature;
          continue;
        }
        if (body.system && /system/i.test(errorBody)) {
          delete body.system;
          body.messages = [
            { role: "user", content: system },
            ...(body.messages as Array<{ role: string; content: string }>),
          ];
          continue;
        }
      }

      throw new Error(
        `OpenCode Go request failed (${response.status}) for ${model.id}: ${errorBody.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as MessagesApiResponse;
    const contentBlocks = (data.content ?? []).filter(
      (block) => block.type === "text" && typeof block.text === "string",
    );
    const content = contentBlocks.map((block) => block.text as string).join("\n");
    const finishReason = data.stop_reason ?? null;

    if (!content && finishReason === "max_tokens" && body.thinking) {
      delete body.thinking;
      continue;
    }

    requireContent(content, model.id, finishReason, data.error?.message);

    if (finishReason === "max_tokens") {
      throw new Error(
        `OpenCode Go response for ${model.id} was cut off before completion (stop_reason=max_tokens)`,
      );
    }

    return {
      content,
      finishReason,
      model: data.model ?? model.id,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    };
  }

  throw new Error(
    `OpenCode Go request failed for ${model.id}: ${lastErrorText.slice(0, 300) || "retries exhausted"}`,
  );
};
