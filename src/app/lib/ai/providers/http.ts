const GO_BASE_URL = "https://opencode.ai/zen/go/v1";

export const DEFAULT_TIMEOUT_MS = 110_000;

export function goApiKey(): string {
  const apiKey = process.env.OPENCODE_GO_API_KEY;
  if (!apiKey) {
    throw new Error("OPENCODE_GO_API_KEY is not configured");
  }
  return apiKey;
}

export async function sendGoRequest(params: {
  path: string;
  body: Record<string, unknown>;
  sessionId: string;
  timeoutMs: number;
  extraHeaders?: Record<string, string>;
}): Promise<Response> {
  return fetch(`${GO_BASE_URL}${params.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${goApiKey()}`,
      "User-Agent": "david-portfolio-blog-bot/1.0",
      "x-opencode-session": params.sessionId,
      ...params.extraHeaders,
    },
    body: JSON.stringify(params.body),
    cache: "no-store",
    signal: AbortSignal.timeout(params.timeoutMs),
  });
}

export async function readErrorBody(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

export function requireContent(
  content: string,
  model: string,
  finishReason: string | null,
  providerError?: string,
): string {
  if (content) {
    return content;
  }
  throw new Error(
    `OpenCode Go returned no content for ${model}: ${providerError ?? "empty response"} (finish_reason=${finishReason})`,
  );
}

export function ensureNotTruncated(
  finishReason: string | null,
  model: string,
): void {
  if (finishReason === "length") {
    throw new Error(
      `OpenCode Go response for ${model} was cut off before completion (finish_reason=length)`,
    );
  }
}
