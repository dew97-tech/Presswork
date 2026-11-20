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
  const windowCutoff = new Date(now.getTime() - WINDOW_MS);

  // One atomic statement: start a new window or increment the current one.
  // Separate read/reset steps undercount when failures arrive in parallel.
  const [row] = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "LoginAttempt" ("key", "count", "windowStart", "updatedAt")
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "LoginAttempt"."windowStart" < ${windowCutoff}
        THEN 1 ELSE "LoginAttempt"."count" + 1 END,
      "blockedUntil" = CASE WHEN "LoginAttempt"."windowStart" < ${windowCutoff}
        THEN NULL ELSE "LoginAttempt"."blockedUntil" END,
      "windowStart" = CASE WHEN "LoginAttempt"."windowStart" < ${windowCutoff}
        THEN ${now} ELSE "LoginAttempt"."windowStart" END,
      "updatedAt" = ${now}
    RETURNING "count"
  `;

  if (row && row.count >= MAX_ATTEMPTS) {
    await prisma.loginAttempt.update({
      where: { key },
      data: { blockedUntil: new Date(now.getTime() + BLOCK_MS) },
    });
  }
}

export async function clearLoginFailures(key: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key } });
}
