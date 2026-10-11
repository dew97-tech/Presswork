"use server";

import {
  getPrompt,
  getPromptDefinition,
  PROMPT_REGISTRY,
  savePromptTemplate,
  unknownTemplateVariables,
  type PromptKey,
} from "@/app/lib/ai/prompts";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const promptInputSchema = z.object({
  system: z.string().min(50).max(30_000),
  user: z.string().min(20).max(30_000),
});

export type PromptActionResult =
  | { ok: true; version: number; system: string; user: string }
  | { ok: false; error: string };

function isPromptKey(value: string): value is PromptKey {
  return value in PROMPT_REGISTRY;
}

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function savePrompt(
  key: string,
  input: { system: string; user: string },
): Promise<PromptActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!isPromptKey(key)) {
    return { ok: false, error: "Unknown prompt key." };
  }

  const parsed = promptInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Prompt text is missing or too short to be valid.",
    };
  }

  const definition = getPromptDefinition(key);
  if (!definition) {
    return { ok: false, error: "Unknown prompt key." };
  }

  const unknown = unknownTemplateVariables(definition, parsed.data);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown variables: ${unknown.join(", ")}. Allowed: ${definition.variables.join(", ")}.`,
    };
  }

  const saved = await savePromptTemplate(key, parsed.data);
  revalidatePath("/admin/prompts");

  return {
    ok: true,
    version: saved.version,
    system: saved.system,
    user: saved.user,
  };
}

export async function restorePromptDefault(
  key: string,
): Promise<PromptActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!isPromptKey(key)) {
    return { ok: false, error: "Unknown prompt key." };
  }

  const definition = getPromptDefinition(key);
  if (!definition) {
    return { ok: false, error: "Unknown prompt key." };
  }

  const saved = await savePromptTemplate(key, definition.defaults);
  revalidatePath("/admin/prompts");

  return {
    ok: true,
    version: saved.version,
    system: saved.system,
    user: saved.user,
  };
}

export async function restorePromptVersion(
  key: string,
  version: number,
): Promise<PromptActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!isPromptKey(key)) {
    return { ok: false, error: "Unknown prompt key." };
  }

  if (!Number.isInteger(version) || version < 0) {
    return { ok: false, error: "Invalid version." };
  }

  const current = await getPrompt(key);
  const entry = current.history.find((item) => item.version === version);
  if (!entry) {
    return { ok: false, error: "That version is no longer in the history." };
  }

  const saved = await savePromptTemplate(key, {
    system: entry.system,
    user: entry.user,
  });
  revalidatePath("/admin/prompts");

  return {
    ok: true,
    version: saved.version,
    system: saved.system,
    user: saved.user,
  };
}
