"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import prisma from "@/app/lib/prisma";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 15 * 60_000;

function attemptKey(ip: string, email: string): string {
  return createHash("sha256").update(`${ip}|${email}`).digest("hex");
}

async function requestKey(email: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headerList.get("x-real-ip")?.trim() || "unknown";
  return attemptKey(ip, email.trim().toLowerCase());
}

function blockedMessage(until: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((until.getTime() - Date.now()) / 60_000),
  );
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function registerFailure(key: string): Promise<void> {
  const now = new Date();
  const existing = await prisma.loginAttempt.findUnique({ where: { key } });

  if (!existing || now.getTime() - existing.windowStart.getTime() > WINDOW_MS) {
    await prisma.loginAttempt.upsert({
      where: { key },
      create: { key, count: 1, windowStart: now },
      update: { count: 1, windowStart: now, blockedUntil: null },
    });
    return;
  }

  const count = existing.count + 1;
  await prisma.loginAttempt.update({
    where: { key },
    data: {
      count,
      ...(count >= MAX_ATTEMPTS
        ? { blockedUntil: new Date(now.getTime() + BLOCK_MS) }
        : {}),
    },
  });
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  const email = String(formData.get("email") ?? "");
  const key = await requestKey(email);

  try {
    const existing = await prisma.loginAttempt.findUnique({ where: { key } });
    if (existing?.blockedUntil && existing.blockedUntil.getTime() > Date.now()) {
      return blockedMessage(existing.blockedUntil);
    }

    await signIn("credentials", formData);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        await registerFailure(key);
        return "Invalid credentials.";
      }
      return "Something went wrong.";
    }
    throw error;
  }
}
