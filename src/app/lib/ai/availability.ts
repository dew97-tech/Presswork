/**
 * AI features (generation, review, analysis) need a model provider key.
 * Without one they are paused: actions return early and the admin UI
 * disables their buttons instead of failing against the provider.
 */
export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENCODE_GO_API_KEY);
}

export const AI_PAUSED_MESSAGE =
  "AI features are paused: no model API key is configured (OPENCODE_GO_API_KEY).";
