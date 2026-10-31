"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import {
  blockedLoginMessage,
  loginAttemptKey,
  loginBlockedUntil,
} from "@/app/lib/login-guard";

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  const email = String(formData.get("email") ?? "");
  const key = await loginAttemptKey(email);
  const blockedUntil = await loginBlockedUntil(key);

  if (blockedUntil) {
    return blockedLoginMessage(blockedUntil);
  }

  try {
    await signIn("credentials", formData);
  } catch (error) {
    if (error instanceof AuthError) {
      return error.type === "CredentialsSignin"
        ? "Invalid credentials."
        : "Something went wrong.";
    }
    throw error;
  }
}
