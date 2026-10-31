import { createHash } from "node:crypto";
import { headers } from "next/headers";
import prisma from "@/app/lib/prisma";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 15 * 60_000;

function attemptKey(ip: string, email: string): string {
  return createHash("sha256").update(`${ip}|${email}`).digest("hex");
}

export async function loginAttemptKey(email: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headerList.get("x-real-ip")?.trim() || "unknown";
  return attemptKey(ip, email.trim().toLowerCase());
}

export function blockedLoginMessage(until: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((until.getTime() - Date.now()) / 60_000),
  );
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export async function loginBlockedUntil(key: string): Promise<Date | null> {
  const existing = await prisma.loginAttempt.findUnique({ where: { key } });
  if (existing?.blockedUntil && existing.blockedUntil.getTime() > Date.now()) {
    return existing.blockedUntil;
  }
  return null;
}

export async function registerLoginFailure(key: string): Promise<void> {
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

export async function clearLoginFailures(key: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key } });
}
