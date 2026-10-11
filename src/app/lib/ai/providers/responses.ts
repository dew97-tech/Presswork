import {
  DEFAULT_TIMEOUT_MS,
  readErrorBody,
  requireContent,
  sendGoRequest,
} from "./http";
import type { ModelCallResult, Provider } from "./types";

interface ResponsesApiResponse {
  model?: string;
  output_text?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

function extractText(data: ResponsesApiResponse): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
}

export const responsesProvider: Provider = async ({
  model,
  messages,
  sessionId,
  temperature,
  maxTokens = 6000,
  reasoningEffort,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  jsonMode = true,
}): Promise<ModelCallResult> => {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const body: Record<string, unknown> = {
    model: model.id,
    input: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    max_output_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(system ? { instructions: system } : {}),
    ...(jsonMode ? { text: { format: { type: "json_object" } } } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };

  let lastErrorText = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await sendGoRequest({
      path: "/responses",
      sessionId,
      timeoutMs,
      body,
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      lastErrorText = errorBody;

      if (response.status === 400) {
        if (body.reasoning && /reasoning/i.test(errorBody)) {
          delete body.reasoning;
          continue;
        }
        if (body.text && /(text|format|json)/i.test(errorBody)) {
          delete body.text;
          continue;
        }
        if (body.temperature !== undefined && /temperature/i.test(errorBody)) {
          delete body.temperature;
          continue;
        }
        if (body.instructions && /instruction/i.test(errorBody)) {
          delete body.instructions;
          continue;
        }
      }

      throw new Error(
        `OpenCode Go request failed (${response.status}) for ${model.id}: ${errorBody.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as ResponsesApiResponse;
    const content = extractText(data);
    const finishReason =
      data.status === "incomplete"
        ? (data.incomplete_details?.reason ?? "incomplete")
        : (data.status ?? null);

    if (!content && finishReason === "max_output_tokens" && body.reasoning) {
      delete body.reasoning;
      continue;
    }

    requireContent(content, model.id, finishReason, data.error?.message);

    if (finishReason === "max_output_tokens") {
      throw new Error(
        `OpenCode Go response for ${model.id} was cut off before completion (incomplete: max_output_tokens)`,
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
