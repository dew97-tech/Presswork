"use server";

import { auth } from "@/auth";
import { runSearchAnalysis, type AnalysisBody } from "@/app/lib/google/analysis";
import { GscAuthError, GscNotConnectedError } from "@/app/lib/google/errors";
import { inspectUrl, isGscConnected } from "@/app/lib/google/search-console";
import prisma from "@/app/lib/prisma";
import { setSetting, SETTINGS_KEYS } from "@/app/lib/settings";
import { revalidatePath } from "next/cache";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://davidmallick.dev"
).replace(/\/$/, "");
const CRAWL_DELAY_MS = 300;
const SYNC_TIME_BUDGET_MS = 540_000;

export interface SyncIndexResult {
  ok: boolean;
  checked?: number;
  indexed?: number;
  errors?: string[];
  incomplete?: boolean;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportsIndexed(state: string): boolean {
  return /indexed/i.test(state) && !/not indexed/i.test(state);
}

export async function syncIndexStatus(): Promise<SyncIndexResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!(await isGscConnected())) {
    return { ok: false, error: "Connect a Google account in settings first." };
  }

  const posts = await prisma.post.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    select: { id: true, slug: true },
  });

  let indexed = 0;
  let processed = 0;
  let incomplete = false;
  const errors: string[] = [];
  const startedAt = Date.now();

  for (let index = 0; index < posts.length; index += 1) {
    if (Date.now() - startedAt > SYNC_TIME_BUDGET_MS) {
      incomplete = true;
      break;
    }

    const post = posts[index];
    processed += 1;

    try {
      const result = await inspectUrl(`${SITE_URL}/blog/${post.slug}`);
      const state = result.coverageState ?? result.verdict ?? null;
      if (state && reportsIndexed(state)) {
        indexed += 1;
      }

      await prisma.post.update({
        where: { id: post.id },
        data: {
          indexStatus: state,
          ...(result.lastCrawlTime
            ? { indexedAt: new Date(result.lastCrawlTime) }
            : {}),
        },
      });
    } catch (error) {
      if (error instanceof GscAuthError || error instanceof GscNotConnectedError) {
        return {
          ok: false,
          error: error.message,
          checked: index,
          indexed,
          errors,
        };
      }

      const message =
        error instanceof Error ? error.message : "URL inspection failed.";
      errors.push(`${post.slug}: ${message}`);
    }

    if (index < posts.length - 1) {
      await delay(CRAWL_DELAY_MS);
    }
  }

  await setSetting(SETTINGS_KEYS.lastIndexSyncAt, new Date().toISOString());
  revalidatePath("/admin/search-console");

  return {
    ok: true,
    checked: processed,
    indexed,
    errors: errors.slice(0, 10),
    incomplete,
  };
}

export type AnalyzeSearchResult =
  | {
      ok: true;
      analysis: AnalysisBody;
      model: string;
      generatedAt: string;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
    }
  | { ok: false; error: string };

function isIsoDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function analyzeSearchPerformance(range: {
  preset: string;
  startDate: string;
  endDate: string;
}): Promise<AnalyzeSearchResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!(await isGscConnected())) {
    return { ok: false, error: "Connect a Google account in settings first." };
  }

  if (
    !isIsoDay(range.startDate) ||
    !isIsoDay(range.endDate) ||
    range.startDate > range.endDate
  ) {
    return { ok: false, error: "Invalid date range." };
  }

  try {
    const result = await runSearchAnalysis({
      startDate: range.startDate,
      endDate: range.endDate,
    });

    await setSetting(SETTINGS_KEYS.lastAnalysis, {
      generatedAt: result.generatedAt,
      model: result.model,
      range: {
        preset: range.preset,
        startDate: range.startDate,
        endDate: range.endDate,
      },
      analysis: result.analysis,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      cost: result.cost ?? null,
    });

    revalidatePath("/admin/search-console");

    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The search analysis failed.",
    };
  }
}
