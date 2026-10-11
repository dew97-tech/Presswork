import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/app/lib/prisma";
import {
  DEFAULT_GENERATION_CHAIN,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_REVIEW_MODEL,
  REASONING_EFFORTS,
} from "@/app/lib/ai/models";

const reasoningEffortSchema = z.enum(REASONING_EFFORTS);

const modelSelectionSchema = z.object({
  modelId: z.string().min(1),
  reasoningEffort: reasoningEffortSchema,
});

export const generationSettingsSchema = z.object({
  chain: z.array(modelSelectionSchema).min(1).max(8),
});

export const reviewSettingsSchema = modelSelectionSchema.extend({
  webSearch: z.boolean(),
});

export const imageSettingsSchema = modelSelectionSchema;

export const analysisSettingsSchema = modelSelectionSchema;

export type GenerationSettings = z.infer<typeof generationSettingsSchema>;
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  chain: DEFAULT_GENERATION_CHAIN,
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  ...DEFAULT_REVIEW_MODEL,
  webSearch: true,
};

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = { ...DEFAULT_IMAGE_MODEL };

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  modelId: "deepseek-v4.1-flash",
  reasoningEffort: "none",
};

export const SETTINGS_KEYS = {
  generation: "ai.generation",
  review: "ai.review",
  image: "ai.image",
  analysis: "ai.analysis",
  catalogMeta: "ai.catalogMeta",
  promptGeneration: "prompts.generation",
  promptReview: "prompts.review",
  promptAnalysis: "prompts.searchAnalysis",
  gscProperty: "gsc.property",
  keywordsPlanner: "keywords.planner",
  keywordsLastSyncAt: "keywords.lastSyncAt",
  lastAnalysis: "gsc.lastAnalysis",
  lastIndexSyncAt: "gsc.lastIndexSyncAt",
  googleAccounts: "google.accounts",
  googleActiveAccount: "google.activeAccount",
  googleAdsAccount: "google.adsAccount",
} as const;

async function readSetting<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) {
      return fallback;
    }

    const parsed = schema.safeParse(row.value);
    if (!parsed.success) {
      console.warn(`Invalid stored value for setting "${key}", using default.`);
      return fallback;
    }

    return parsed.data;
  } catch (error) {
    console.warn(`Failed to read setting "${key}":`, error);
    return fallback;
  }
}

export async function getSetting<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  return readSetting(key, schema, fallback);
}

export async function getGenerationSettings(): Promise<GenerationSettings> {
  return readSetting(
    SETTINGS_KEYS.generation,
    generationSettingsSchema,
    DEFAULT_GENERATION_SETTINGS,
  );
}

export async function getReviewSettings(): Promise<ReviewSettings> {
  return readSetting(
    SETTINGS_KEYS.review,
    reviewSettingsSchema,
    DEFAULT_REVIEW_SETTINGS,
  );
}

export async function getImageSettings(): Promise<ImageSettings> {
  return readSetting(
    SETTINGS_KEYS.image,
    imageSettingsSchema,
    DEFAULT_IMAGE_SETTINGS,
  );
}

export async function getAnalysisSettings(): Promise<AnalysisSettings> {
  return readSetting(
    SETTINGS_KEYS.analysis,
    analysisSettingsSchema,
    DEFAULT_ANALYSIS_SETTINGS,
  );
}

export const DEFAULT_GSC_PROPERTY = "sc-domain:davidmallick.dev";

export async function getGscProperty(): Promise<string> {
  const fallback = process.env.GSC_PROPERTY?.trim() || DEFAULT_GSC_PROPERTY;
  return readSetting(SETTINGS_KEYS.gscProperty, z.string().min(1), fallback);
}

export async function getLastIndexSyncAt(): Promise<string | null> {
  return readSetting(SETTINGS_KEYS.lastIndexSyncAt, z.string().nullable(), null);
}

export const lastAnalysisSchema = z.object({
  generatedAt: z.string(),
  model: z.string(),
  range: z.object({
    preset: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  analysis: z.object({
    summary: z.string(),
    priorities: z.array(
      z.object({
        title: z.string(),
        why: z.string(),
        action: z.string(),
        impact: z.enum(["high", "medium", "low"]).catch("medium"),
      }),
    ),
    quickWins: z.array(z.object({ title: z.string(), action: z.string() })),
  }),
  inputTokens: z.number().nullish(),
  outputTokens: z.number().nullish(),
  cost: z.number().nullish(),
});

export type LastAnalysis = z.infer<typeof lastAnalysisSchema>;

export async function getLastAnalysis(): Promise<LastAnalysis | null> {
  return readSetting(
    SETTINGS_KEYS.lastAnalysis,
    lastAnalysisSchema.nullable(),
    null,
  );
}

const customerIdSchema = z.string().regex(/^\d{10}$/).or(z.literal(""));

export const keywordPlannerSettingsSchema = z.object({
  customerId: customerIdSchema,
  loginCustomerId: customerIdSchema,
  geo: z.string().min(1).max(40),
  language: z.string().min(1).max(40),
  network: z.enum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"]),
});

export type KeywordPlannerSettings = z.infer<
  typeof keywordPlannerSettingsSchema
>;

export const DEFAULT_KEYWORD_PLANNER_SETTINGS: KeywordPlannerSettings = {
  customerId: "",
  loginCustomerId: "",
  geo: "2840",
  language: "1000",
  network: "GOOGLE_SEARCH",
};

export async function getKeywordPlannerSettings(): Promise<KeywordPlannerSettings> {
  return readSetting(
    SETTINGS_KEYS.keywordsPlanner,
    keywordPlannerSettingsSchema,
    DEFAULT_KEYWORD_PLANNER_SETTINGS,
  );
}

export async function getKeywordsLastSyncAt(): Promise<string | null> {
  return readSetting(SETTINGS_KEYS.keywordsLastSyncAt, z.string().nullable(), null);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
}
