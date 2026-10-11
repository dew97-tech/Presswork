"use server";

import { auth } from "@/auth";
import {
  activateGoogleAccount,
  captureConnectionIntoActiveAccount,
  setAdsAccountLabel,
  type ActivateAccountResult,
} from "@/app/lib/google/accounts";
import { revalidatePath } from "next/cache";

export async function switchGoogleAccount(
  label: string,
): Promise<ActivateAccountResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await activateGoogleAccount(label);
  if (result.ok) {
    revalidatePath("/admin/settings");
    revalidatePath("/admin/keywords");
  }
  return result;
}

export async function flagAdsGoogleAccount(
  label: string | null,
): Promise<ActivateAccountResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    await setAdsAccountLabel(label);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not flag the account.",
    };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/keywords");
  return { ok: true };
}

export async function storeCurrentConnection(): Promise<ActivateAccountResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await captureConnectionIntoActiveAccount();
  if (result.ok) {
    revalidatePath("/admin/settings");
  }
  return result;
}
