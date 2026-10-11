export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type GoEndpoint = "chat" | "responses" | "messages";

export type GoTier = "free" | "cheap" | "standard";

export interface GoModel {
  id: string;
  label: string;
  endpoint: GoEndpoint;
  inputPricePerM: number | null;
  outputPricePerM: number | null;
  contextWindow: number | null;
  reasoning: boolean;
  tier: GoTier;
  monthlyLimitUsd?: number;
  vision?: boolean;
  regionNote?: string;
  priceNote?: string;
}

export const GO_MODEL_CATALOG: readonly GoModel[] = [
  {
    id: "gpt-6-luna",
    label: "GPT 6 Luna",
    endpoint: "responses",
    inputPricePerM: 0.1,
    outputPricePerM: 0.5,
    contextWindow: 272_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 15,
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT 5.6 Luna",
    endpoint: "responses",
    inputPricePerM: 0.2,
    outputPricePerM: 1.2,
    contextWindow: 272_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 15,
  },
  {
    id: "glm-5.3-flash",
    label: "GLM-5.3-Flash",
    endpoint: "chat",
    inputPricePerM: 0.15,
    outputPricePerM: 0.5,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    endpoint: "chat",
    inputPricePerM: 0.15,
    outputPricePerM: 0.6,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
    priceNote: "Off-peak pricing; peak doubles",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    endpoint: "chat",
    inputPricePerM: 0.15,
    outputPricePerM: 0.6,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 30,
    priceNote: "Off-peak pricing; peak doubles",
  },
  {
    id: "deepseek-v4-flash-vision-exp",
    label: "DeepSeek V4 Flash Vision",
    endpoint: "chat",
    inputPricePerM: 0.15,
    outputPricePerM: 0.6,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 15,
    vision: true,
    priceNote: "Off-peak pricing; peak doubles",
  },
  {
    id: "qwen3.8-flash",
    label: "Qwen3.8 Flash",
    endpoint: "messages",
    inputPricePerM: 0.15,
    outputPricePerM: 0.47,
    contextWindow: 256_000,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 30,
  },
  {
    id: "mimo-v2.5",
    label: "MiMo-V2.5",
    endpoint: "chat",
    inputPricePerM: 0.14,
    outputPricePerM: 0.28,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
  },
  {
    id: "mimo-v2.5-pro",
    label: "MiMo-V2.5-Pro",
    endpoint: "chat",
    inputPricePerM: 0.435,
    outputPricePerM: 0.87,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 15,
  },
  {
    id: "mimo-v2.6-flash",
    label: "MiMo-V2.6-Flash",
    endpoint: "chat",
    inputPricePerM: null,
    outputPricePerM: null,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
    priceNote: "Pricing not documented yet",
  },
  {
    id: "hy3",
    label: "Hy3",
    endpoint: "chat",
    inputPricePerM: 0.14,
    outputPricePerM: 0.58,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
  },
  {
    id: "longcat-2.0",
    label: "LongCat-2.0",
    endpoint: "chat",
    inputPricePerM: 0.3,
    outputPricePerM: 1.2,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
  },
  {
    id: "minimax-m3",
    label: "MiniMax M3",
    endpoint: "messages",
    inputPricePerM: 0.3,
    outputPricePerM: 1.2,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
  },
  {
    id: "minimax-m2.7",
    label: "MiniMax M2.7",
    endpoint: "messages",
    inputPricePerM: 0.3,
    outputPricePerM: 1.2,
    contextWindow: null,
    reasoning: true,
    tier: "cheap",
    monthlyLimitUsd: 60,
  },
  {
    id: "longcat-2.5-preview-free",
    label: "LongCat 2.5 Preview Free",
    endpoint: "chat",
    inputPricePerM: 0,
    outputPricePerM: 0,
    contextWindow: null,
    reasoning: true,
    tier: "free",
    priceNote: "Free for a limited time",
  },
  {
    id: "space-bunny-free",
    label: "Space Bunny Free",
    endpoint: "chat",
    inputPricePerM: 0,
    outputPricePerM: 0,
    contextWindow: null,
    reasoning: true,
    tier: "free",
    priceNote: "Free for a limited time",
  },
  {
    id: "muse-spark-1.3-contributor",
    label: "Muse Spark 1.3 Contributor",
    endpoint: "responses",
    inputPricePerM: 0,
    outputPricePerM: 0,
    contextWindow: null,
    reasoning: true,
    tier: "free",
    regionNote: "Limited regions",
  },
  {
    id: "muse-spark-1.2-contributor",
    label: "Muse Spark 1.2 Contributor",
    endpoint: "responses",
    inputPricePerM: 0,
    outputPricePerM: 0,
    contextWindow: null,
    reasoning: true,
    tier: "free",
    regionNote: "Limited regions",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    endpoint: "chat",
    inputPricePerM: 0.66,
    outputPricePerM: 1.98,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 15,
    priceNote: "Off-peak pricing; peak doubles",
  },
  {
    id: "mimo-v2.6-pro",
    label: "MiMo-V2.6-Pro",
    endpoint: "chat",
    inputPricePerM: null,
    outputPricePerM: null,
    contextWindow: null,
    reasoning: true,
    tier: "standard",
    priceNote: "Pricing not documented yet",
  },
  {
    id: "hy4-preview",
    label: "Hy4 preview",
    endpoint: "chat",
    inputPricePerM: 0.834,
    outputPricePerM: 2.501,
    contextWindow: null,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 30,
  },
  {
    id: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    endpoint: "chat",
    inputPricePerM: 0.95,
    outputPricePerM: 4,
    contextWindow: 262_144,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 60,
  },
  {
    id: "qwen3.7-plus",
    label: "Qwen3.7 Plus",
    endpoint: "messages",
    inputPricePerM: 0.4,
    outputPricePerM: 1.6,
    contextWindow: 256_000,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 60,
  },
  {
    id: "glm-5.3",
    label: "GLM-5.3",
    endpoint: "chat",
    inputPricePerM: 1.4,
    outputPricePerM: 4.4,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 15,
  },
  {
    id: "glm-5.2",
    label: "GLM-5.2",
    endpoint: "chat",
    inputPricePerM: 1.4,
    outputPricePerM: 4.4,
    contextWindow: 1_000_000,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 60,
  },
  {
    id: "deepseek-flash",
    label: "DeepSeek Flash",
    endpoint: "chat",
    inputPricePerM: null,
    outputPricePerM: null,
    contextWindow: null,
    reasoning: false,
    tier: "standard",
    priceNote: "Undocumented id; pricing not listed",
  },
  {
    id: "qwen3.8-max",
    label: "Qwen3.8 Max",
    endpoint: "messages",
    inputPricePerM: 2,
    outputPricePerM: 6,
    contextWindow: null,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 15,
  },
  {
    id: "grok-4.6",
    label: "Grok 4.6",
    endpoint: "responses",
    inputPricePerM: 2,
    outputPricePerM: 6,
    contextWindow: 200_000,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 15,
  },
  {
    id: "grok-4.7",
    label: "Grok 4.7",
    endpoint: "responses",
    inputPricePerM: 2,
    outputPricePerM: 6,
    contextWindow: 200_000,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 15,
  },
  {
    id: "kimi-k3",
    label: "Kimi K3",
    endpoint: "chat",
    inputPricePerM: 3,
    outputPricePerM: 15,
    contextWindow: 1_048_576,
    reasoning: true,
    tier: "standard",
    monthlyLimitUsd: 15,
  },
] as const;

const TIER_ORDER: Record<GoTier, number> = { free: 0, cheap: 1, standard: 2 };

const modelById = new Map(GO_MODEL_CATALOG.map((model) => [model.id, model]));

export function getModel(id: string): GoModel | undefined {
  return modelById.get(id);
}

export function listModels(): GoModel[] {
  return [...GO_MODEL_CATALOG].sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      (a.inputPricePerM ?? Number.POSITIVE_INFINITY) -
        (b.inputPricePerM ?? Number.POSITIVE_INFINITY) ||
      a.label.localeCompare(b.label),
  );
}

export function isKnownModelId(id: string): boolean {
  return modelById.has(id);
}

export function priceLabel(model: GoModel): string {
  if (model.tier === "free") return "Free";
  if (model.inputPricePerM === null || model.outputPricePerM === null) {
    return "Pricing not listed";
  }
  return `$${model.inputPricePerM.toFixed(2)} in / $${model.outputPricePerM.toFixed(2)} out per 1M`;
}

export interface ModelSelection {
  modelId: string;
  reasoningEffort: ReasoningEffort;
}

export const DEFAULT_GENERATION_CHAIN: ModelSelection[] = [
  { modelId: "deepseek-v4.1-flash", reasoningEffort: "none" },
  { modelId: "mimo-v2.5", reasoningEffort: "none" },
  { modelId: "glm-5.3-flash", reasoningEffort: "none" },
];

export const DEFAULT_REVIEW_MODEL: ModelSelection = {
  modelId: "deepseek-v4.1-flash",
  reasoningEffort: "none",
};

export const DEFAULT_IMAGE_MODEL: ModelSelection = {
  modelId: "glm-5.3-flash",
  reasoningEffort: "none",
};
