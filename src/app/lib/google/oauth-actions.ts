"use server";

import { auth } from "@/auth";
import { disconnect, listProperties, type GscProperty } from "@/app/lib/google/oauth";
import { setSetting, SETTINGS_KEYS } from "@/app/lib/settings";
import { revalidatePath } from "next/cache";

export interface GoogleActionResult {
  ok: boolean;
  error?: string;
}

export async function disconnectGoogleAccount(): Promise<GoogleActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    await disconnect();
    revalidatePath("/admin/settings");
    revalidatePath("/admin/search-console");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not disconnect Google.",
    };
  }
}

export type GscPropertiesResult =
  | { ok: true; properties: GscProperty[] }
  | { ok: false; error: string };

export async function fetchGscProperties(): Promise<GscPropertiesResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    return { ok: true, properties: await listProperties() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not list properties.",
    };
  }
}

export async function saveGscProperty(property: string): Promise<GoogleActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const trimmed = property.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a Search Console property first." };
  }
  if (trimmed.length > 300) {
    return { ok: false, error: "That property string is too long." };
  }

  await setSetting(SETTINGS_KEYS.gscProperty, trimmed);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/search-console");
  return { ok: true };
}
