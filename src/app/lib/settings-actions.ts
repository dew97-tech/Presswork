"use server";

import { callModel } from "@/app/lib/ai/call-model";
import { getModel, GO_MODEL_CATALOG } from "@/app/lib/ai/models";
import {
  analysisSettingsSchema,
  generationSettingsSchema,
  imageSettingsSchema,
  keywordPlannerSettingsSchema,
  reviewSettingsSchema,
  setSetting,
  SETTINGS_KEYS,
  type KeywordPlannerSettings,
} from "@/app/lib/settings";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const settingsInputSchema = z.object({
  generation: generationSettingsSchema,
  review: reviewSettingsSchema,
  image: imageSettingsSchema,
  analysis: analysisSettingsSchema,
});

export type AiSettingsInput = z.infer<typeof settingsInputSchema>;

export interface SaveSettingsResult {
  ok: boolean;
  error?: string;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

export async function saveKeywordPlannerSettings(
  input: KeywordPlannerSettings,
): Promise<SaveSettingsResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = keywordPlannerSettingsSchema.safeParse({
    ...input,
    customerId: digitsOnly(input.customerId),
    loginCustomerId: digitsOnly(input.loginCustomerId),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error:
        "Enter a 10-digit customer ID (and login customer ID when using an MCC), plus geo and language targets.",
    };
  }

  await setSetting(SETTINGS_KEYS.keywordsPlanner, parsed.data);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/keywords");
  return { ok: true };
}

export async function saveAiSettings(
  input: AiSettingsInput,
): Promise<SaveSettingsResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid settings payload." };
  }

  const ids = [
    ...parsed.data.generation.chain.map((entry) => entry.modelId),
    parsed.data.review.modelId,
    parsed.data.image.modelId,
    parsed.data.analysis.modelId,
  ];
  const unknown = ids.find((id) => !getModel(id));
  if (unknown) {
    return { ok: false, error: `Unknown model id "${unknown}".` };
  }

  await Promise.all([
    setSetting(SETTINGS_KEYS.generation, parsed.data.generation),
    setSetting(SETTINGS_KEYS.review, parsed.data.review),
    setSetting(SETTINGS_KEYS.image, parsed.data.image),
    setSetting(SETTINGS_KEYS.analysis, parsed.data.analysis),
  ]);

  revalidatePath("/admin/settings");
  return { ok: true };
}

export type TestModelResult =
  | { ok: true; latencyMs: number; sample: string }
  | { ok: false; error: string };

export async function testModel(modelId: string): Promise<TestModelResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const model = getModel(modelId);
  if (!model) {
    return { ok: false, error: `Unknown model id "${modelId}".` };
  }

  const startedAt = Date.now();

  try {
    const result = await callModel({
      modelId,
      messages: [
        {
          role: "system",
          content: "You are a precise assistant. Reply with JSON only.",
        },
        { role: "user", content: 'Return exactly {"ok": true} as JSON.' },
      ],
      sessionId: `settings-test-${modelId}-${Date.now()}`,
      maxTokens: 300,
      temperature: 0,
      jsonMode: true,
      timeoutMs: 60_000,
      reasoningEffort: "none",
    });

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample: result.content.trim().slice(0, 80),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Model test failed.",
    };
  }
}

export type RefreshCatalogResult =
  | { ok: true; count: number; missing: string[]; stale: string[] }
  | { ok: false; error: string };

export async function refreshModelCatalog(): Promise<RefreshCatalogResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const apiKey = process.env.OPENCODE_GO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "OPENCODE_GO_API_KEY is not configured." };
  }

  try {
    const response = await fetch("https://opencode.ai/zen/go/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Model list request failed (${response.status}).`,
      };
    }

    const data = (await response.json()) as
      | { data?: Array<{ id?: string }> }
      | Array<{ id?: string }>;
    const list = Array.isArray(data) ? data : (data.data ?? []);
    const ids = list
      .map((entry) => entry.id)
      .filter((id): id is string => Boolean(id));

    const missing = ids.filter((id) => !getModel(id));
    const stale = GO_MODEL_CATALOG.map((model) => model.id).filter(
      (id) => !ids.includes(id),
    );

    await setSetting(SETTINGS_KEYS.catalogMeta, {
      lastSyncedAt: new Date().toISOString(),
      availableModelIds: ids,
    });

    return { ok: true, count: ids.length, missing, stale };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Model catalog refresh failed.",
    };
  }
}
