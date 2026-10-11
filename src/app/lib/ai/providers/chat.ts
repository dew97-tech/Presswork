import {
  DEFAULT_TIMEOUT_MS,
  ensureNotTruncated,
  readErrorBody,
  requireContent,
  sendGoRequest,
} from "./http";
import type { ModelCallResult, Provider } from "./types";

interface ChatCompletionResponse {
  model?: string;
  cost?: number | string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string; param?: string; type?: string };
}

function parseCost(raw: number | string | undefined): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const chatProvider: Provider = async ({
  model,
  messages,
  sessionId,
  temperature = 0.7,
  maxTokens = 6000,
  reasoningEffort,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  jsonMode = true,
}): Promise<ModelCallResult> => {
  let currentEffort = reasoningEffort;
  let useJsonMode = jsonMode;
  let useTemperature = true;
  let lastErrorText = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      max_tokens: maxTokens,
      stream: false,
    };

    if (useTemperature) {
      body.temperature = temperature;
    }
    if (useJsonMode) {
      body.response_format = { type: "json_object" };
    }
    if (currentEffort) {
      body.reasoning_effort = currentEffort;
    }

    const response = await sendGoRequest({
      path: "/chat/completions",
      sessionId,
      timeoutMs,
      body,
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      lastErrorText = errorBody;

      if (response.status === 400) {
        if (currentEffort && /reasoning/i.test(errorBody)) {
          currentEffort = undefined;
          continue;
        }
        if (useJsonMode && /(response_format|json|format)/i.test(errorBody)) {
          useJsonMode = false;
          continue;
        }
        if (useJsonMode) {
          useJsonMode = false;
          continue;
        }
        if (currentEffort) {
          currentEffort = undefined;
          continue;
        }
        if (useTemperature) {
          useTemperature = false;
          continue;
        }
      }

      throw new Error(
        `OpenCode Go request failed (${response.status}) for ${model.id}: ${errorBody.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    const finishReason = choice?.finish_reason ?? null;

    if (
      !content &&
      finishReason === "length" &&
      currentEffort !== undefined &&
      currentEffort !== "none"
    ) {
      currentEffort = "none";
      continue;
    }

    requireContent(content, model.id, finishReason, data.error?.message);
    ensureNotTruncated(finishReason, model.id);

    return {
      content,
      finishReason,
      model: data.model ?? model.id,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      cost: parseCost(data.cost),
    };
  }

  throw new Error(
    `OpenCode Go request failed for ${model.id}: ${lastErrorText.slice(0, 300) || "retries exhausted"}`,
  );
};
