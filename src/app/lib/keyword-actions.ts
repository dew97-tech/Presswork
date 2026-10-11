"use server";

import { auth } from "@/auth";
import { runBlogGeneration } from "@/app/lib/ai/generate-blog";
import { CATEGORY_KEYWORD_BANK } from "@/app/lib/ai/keywords";
import { isBannedTopic } from "@/app/lib/ai/trends";
import {
  generateHistoricalMetrics,
  generateKeywordIdeas,
  GoogleAdsApiError,
  GoogleAdsConfigError,
  type KeywordIdea,
} from "@/app/lib/google/ads";
import { fetchSearchQueries } from "@/app/lib/google/search-console";
import prisma from "@/app/lib/prisma";
import {
  getKeywordsLastSyncAt,
  setSetting,
  SETTINGS_KEYS,
} from "@/app/lib/settings";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

const SYNC_COOLDOWN_MS = 30_000;
const MAX_SYNC_CALLS = 3;
const SEEDS_PER_CALL = 5;
const MAX_SYNC_RESULTS = 700;
const MAX_METRIC_KEYWORDS = 700;
const MAX_SEED_KEYWORDS = 30;
const ACTIONS_TIME_BUDGET_MS = 540_000;

export interface SyncKeywordIdeasResult {
  ok: boolean;
  error?: string;
  hint?: string | null;
  added?: number;
  updated?: number;
  total?: number;
  calls?: number;
  incomplete?: boolean;
}

export interface KeywordActionResult {
  ok: boolean;
  error?: string;
  hint?: string | null;
  updated?: number;
  keyword?: string;
  incomplete?: boolean;
}

function canonical(value: string): string {
  return value.trim().toLowerCase();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = canonical(value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique;
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function defaultSeedKeywords(): string[] {
  return dedupe(
    Object.values(CATEGORY_KEYWORD_BANK)
      .flatMap((keywords) => keywords.slice(0, 3)),
  ).slice(0, 20);
}

function adsError(error: unknown): { error: string; hint: string | null } {
  if (error instanceof GoogleAdsConfigError) {
    return { error: error.message, hint: null };
  }
  if (error instanceof GoogleAdsApiError) {
    return { error: error.message, hint: error.hint };
  }
  return {
    error:
      error instanceof Error ? error.message : "The Google Ads request failed.",
    hint: null,
  };
}

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

function metricData(idea: KeywordIdea) {
  const microsToBigInt = (value: number | null): bigint | null =>
    value === null ? null : BigInt(Math.round(value));

  return {
    avgMonthlySearches: idea.avgMonthlySearches,
    competition: idea.competition,
    competitionIndex: idea.competitionIndex,
    lowTopOfPageBidMicros: microsToBigInt(idea.lowTopOfPageBidMicros),
    highTopOfPageBidMicros: microsToBigInt(idea.highTopOfPageBidMicros),
    monthlyVolumes: idea.monthlyVolumes as unknown as Prisma.InputJsonValue,
    fetchedAt: new Date(),
  };
}

export async function syncKeywordIdeas(input: {
  seeds?: string;
  siteUrl?: string;
  minVolume?: number;
}): Promise<SyncKeywordIdeasResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const lastSync = await getKeywordsLastSyncAt();
  if (lastSync) {
    const elapsed = Date.now() - new Date(lastSync).getTime();
    if (elapsed >= 0 && elapsed < SYNC_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000);
      return {
        ok: false,
        error: `A sync ran moments ago. Try again in ${waitSeconds}s.`,
      };
    }
  }

  const customSeeds = (input.seeds ?? "")
    .split(/[\n,]+/)
    .map((seed) => seed.trim())
    .filter(Boolean);

  const gscQueries = await fetchSearchQueries(10)
    .then((queries) => queries.map((query) => query.query))
    .catch(() => [] as string[]);

  const seeds = dedupe([
    ...(customSeeds.length > 0 ? customSeeds : defaultSeedKeywords()),
    ...gscQueries,
  ]).slice(0, MAX_SEED_KEYWORDS);

  const siteUrl = input.siteUrl?.trim() ?? "";
  const ideas: KeywordIdea[] = [];
  let calls = 0;

  try {
    if (siteUrl && seeds.length > 0) {
      ideas.push(
        ...(await generateKeywordIdeas({
          seeds: seeds.slice(0, SEEDS_PER_CALL),
          url: siteUrl,
        })),
      );
      calls += 1;
    } else if (siteUrl) {
      ideas.push(...(await generateKeywordIdeas({ url: siteUrl })));
      calls += 1;
    }

    const remaining = siteUrl ? seeds.slice(SEEDS_PER_CALL) : seeds;
    for (const group of chunk(remaining, SEEDS_PER_CALL)) {
      if (calls >= MAX_SYNC_CALLS) break;
      ideas.push(...(await generateKeywordIdeas({ seeds: group })));
      calls += 1;
    }
  } catch (error) {
    return { ok: false, ...adsError(error) };
  }

  const minVolume =
    typeof input.minVolume === "number" &&
    Number.isFinite(input.minVolume) &&
    input.minVolume > 0
      ? Math.trunc(input.minVolume)
      : 0;

  const seen = new Set<string>();
  const filtered: KeywordIdea[] = [];
  for (const idea of ideas) {
    const keyword = canonical(idea.keyword);
    if (keyword.length === 0 || seen.has(keyword)) continue;
    if (isBannedTopic(keyword)) continue;
    if (minVolume > 0 && (idea.avgMonthlySearches ?? 0) < minVolume) continue;
    seen.add(keyword);
    filtered.push({ ...idea, keyword });
    if (filtered.length >= MAX_SYNC_RESULTS) break;
  }

  if (filtered.length === 0) {
    await setSetting(SETTINGS_KEYS.keywordsLastSyncAt, new Date().toISOString());
    return { ok: true, added: 0, updated: 0, total: 0, calls };
  }

  const existingRows = await prisma.keyword.findMany({
    where: { keyword: { in: filtered.map((idea) => idea.keyword) } },
    select: { keyword: true },
  });
  const existing = new Set(existingRows.map((row) => row.keyword));

  let added = 0;
  let updated = 0;
  let incomplete = false;
  const startedAt = Date.now();

  for (const idea of filtered) {
    if (Date.now() - startedAt > ACTIONS_TIME_BUDGET_MS) {
      incomplete = true;
      break;
    }

    const metrics = metricData(idea);
    await prisma.keyword.upsert({
      where: { keyword: idea.keyword },
      create: {
        keyword: idea.keyword,
        source: "keyword_planner",
        ...metrics,
      },
      update: metrics,
    });

    if (existing.has(idea.keyword)) {
      updated += 1;
    } else {
      added += 1;
    }
  }

  await setSetting(SETTINGS_KEYS.keywordsLastSyncAt, new Date().toISOString());
  revalidatePath("/admin/keywords");

  return {
    ok: true,
    added,
    updated,
    total: added + updated,
    calls,
    incomplete,
  };
}

export async function addKeyword(input: string): Promise<KeywordActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const keyword = canonical(input);
  if (keyword.length < 2 || keyword.length > 120) {
    return { ok: false, error: "Keywords must be 2 to 120 characters." };
  }
  if (isBannedTopic(keyword)) {
    return { ok: false, error: "That keyword matches a banned topic." };
  }

  const existing = await prisma.keyword.findUnique({
    where: { keyword },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "That keyword is already in the list." };
  }

  await prisma.keyword.create({
    data: { keyword, source: "manual" },
  });

  revalidatePath("/admin/keywords");
  return { ok: true, keyword };
}

export async function setKeywordStatus(
  id: string,
  status: "new" | "ignored",
): Promise<KeywordActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await prisma.keyword.updateMany({
    where: { id, status: { not: "used" } },
    data: { status },
  });

  if (result.count === 0) {
    return {
      ok: false,
      error: "Only new or ignored keywords can be changed.",
    };
  }

  revalidatePath("/admin/keywords");
  return { ok: true };
}

export async function refreshKeywordMetrics(
  ids: string[],
): Promise<KeywordActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const uniqueIds = Array.from(new Set(ids)).slice(0, MAX_METRIC_KEYWORDS);
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Select at least one keyword first." };
  }

  const rows = await prisma.keyword.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, keyword: true },
  });
  if (rows.length === 0) {
    return { ok: false, error: "Those keywords no longer exist." };
  }

  let ideas: KeywordIdea[];
  try {
    ideas = await generateHistoricalMetrics(rows.map((row) => row.keyword));
  } catch (error) {
    return { ok: false, ...adsError(error) };
  }

  const byKeyword = new Map(
    ideas.map((idea) => [canonical(idea.keyword), idea]),
  );

  let updated = 0;
  let incomplete = false;
  const startedAt = Date.now();

  for (const row of rows) {
    if (Date.now() - startedAt > ACTIONS_TIME_BUDGET_MS) {
      incomplete = true;
      break;
    }

    const idea = byKeyword.get(row.keyword);
    if (!idea) continue;
    await prisma.keyword.update({
      where: { id: row.id },
      data: metricData(idea),
    });
    updated += 1;
  }

  revalidatePath("/admin/keywords");
  return { ok: true, updated, incomplete };
}

export interface GenerateKeywordDraftResult {
  ok: boolean;
  error?: string;
  status?: "success" | "skipped" | "failed";
  detail?: string;
  postId?: string;
  slug?: string;
  model?: string;
  wordCount?: number;
}

export async function generateDraftFromKeyword(
  keywordId: string,
): Promise<GenerateKeywordDraftResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const keyword = await prisma.keyword.findUnique({
    where: { id: keywordId },
    select: { id: true },
  });
  if (!keyword) {
    return { ok: false, error: "That keyword no longer exists." };
  }

  const result = await runBlogGeneration({ force: true, keywordId });

  revalidatePath("/admin/keywords");

  if (result.status === "success") {
    return {
      ok: true,
      status: "success",
      postId: result.postId,
      slug: result.slug,
      model: result.model,
      wordCount: result.wordCount,
      detail: `${result.wordCount} words with ${result.model}.`,
    };
  }

  if (result.status === "skipped") {
    return { ok: false, status: "skipped", error: result.detail };
  }

  return {
    ok: false,
    status: "failed",
    error: result.error,
    detail: result.errors?.map((entry) => entry.message).join(" "),
  };
}
