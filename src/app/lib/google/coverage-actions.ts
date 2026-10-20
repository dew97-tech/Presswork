"use server";

import { auth } from "@/auth";
import {
  COVERAGE_RESOLUTIONS,
  emptyCoverageSnapshot,
  mergeCoverageIssues,
  normalizeCoverageIssueReason,
  parseCoverageCsv,
  type CoverageIssue,
  type CoverageResolution,
  type CoverageUrlCheck,
} from "@/app/lib/google/coverage";
import { GscAuthError, GscNotConnectedError } from "@/app/lib/google/errors";
import {
  inspectUrl,
  isGscConnected,
} from "@/app/lib/google/search-console";
import {
  getCoverageSnapshot,
  setSetting,
  SETTINGS_KEYS,
} from "@/app/lib/settings";
import { getSiteUrl } from "@/app/lib/site";
import { revalidatePath } from "next/cache";

export type CoverageActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type ImportCoverageResult =
  | {
      ok: true;
      issues: number;
      pages: number;
      importedAt: string;
    }
  | { ok: false; error: string };

export type InspectCoverageUrlsResult =
  | {
      ok: true;
      checked: number;
      errors: string[];
      results: CoverageUrlCheck[];
    }
  | { ok: false; error: string };

const MAX_CSV_BYTES = 900_000;
const MAX_URLS = 20;
const INSPECT_CONCURRENCY = 3;
const INSPECT_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function combineImportedIssues(
  critical: CoverageIssue[],
  nonCritical: CoverageIssue[],
): CoverageIssue[] {
  const merged = new Map<string, CoverageIssue>();

  for (const issue of [...critical, ...nonCritical]) {
    const existing = merged.get(issue.reason);
    if (existing) {
      existing.pages += issue.pages;
      continue;
    }
    merged.set(issue.reason, issue);
  }

  return [...merged.values()].slice(0, 200);
}

export async function importCoverageExports(input: {
  criticalCsv: string;
  nonCriticalCsv: string;
}): Promise<ImportCoverageResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const criticalCsv =
    typeof input.criticalCsv === "string" ? input.criticalCsv : "";
  const nonCriticalCsv =
    typeof input.nonCriticalCsv === "string" ? input.nonCriticalCsv : "";

  if (!criticalCsv.trim() && !nonCriticalCsv.trim()) {
    return { ok: false, error: "Choose at least one coverage CSV file." };
  }

  if (
    Buffer.byteLength(criticalCsv, "utf8") > MAX_CSV_BYTES ||
    Buffer.byteLength(nonCriticalCsv, "utf8") > MAX_CSV_BYTES
  ) {
    return { ok: false, error: "The coverage CSV file is too large." };
  }

  const imported = combineImportedIssues(
    criticalCsv.trim() ? parseCoverageCsv(criticalCsv) : [],
    nonCriticalCsv.trim() ? parseCoverageCsv(nonCriticalCsv) : [],
  );

  if (imported.length === 0) {
    return {
      ok: false,
      error:
        "No coverage issues were found. Use Critical issues.csv and Non-critical issues.csv from the Search Console coverage export.",
    };
  }

  const current = (await getCoverageSnapshot()) ?? emptyCoverageSnapshot();
  const issues = mergeCoverageIssues(current.issues, imported);
  const importedAt = new Date().toISOString();

  await setSetting(SETTINGS_KEYS.coverageSnapshot, {
    ...current,
    importedAt,
    issues,
  });

  revalidatePath("/admin/search-console");

  return {
    ok: true,
    issues: issues.length,
    pages: issues.reduce((total, issue) => total + issue.pages, 0),
    importedAt,
  };
}

export async function setCoverageIssueResolution(input: {
  reason: string;
  resolution: CoverageResolution;
  note?: string;
}): Promise<CoverageActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const reason = normalizeCoverageIssueReason(
    typeof input.reason === "string" ? input.reason : "",
  );
  if (!reason) {
    return { ok: false, error: "Missing issue reason." };
  }

  if (!COVERAGE_RESOLUTIONS.includes(input.resolution)) {
    return { ok: false, error: "Invalid resolution." };
  }

  const current = (await getCoverageSnapshot()) ?? emptyCoverageSnapshot();
  const issue = current.issues.find((entry) => entry.reason === reason);
  if (!issue) {
    return { ok: false, error: "Coverage issue not found." };
  }

  const issues = current.issues.map((entry) =>
    entry.reason === reason
      ? {
          ...entry,
          resolution: input.resolution,
          note: input.note?.trim().slice(0, 500) || null,
          updatedAt: new Date().toISOString(),
        }
      : entry,
  );

  await setSetting(SETTINGS_KEYS.coverageSnapshot, {
    ...current,
    issues,
  });

  revalidatePath("/admin/search-console");
  return { ok: true };
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const siteHost = new URL(getSiteUrl()).hostname.replace(/^www\./i, "");
    const inputHost = url.hostname.replace(/^www\./i, "");
    if (inputHost !== siteHost) {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function inspectCoverageUrls(input: {
  urls: string[];
  issueReason?: string;
}): Promise<InspectCoverageUrlsResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!(await isGscConnected())) {
    return { ok: false, error: "Connect a Google account in settings first." };
  }

  const issueReason =
    typeof input.issueReason === "string" && input.issueReason
      ? normalizeCoverageIssueReason(input.issueReason)
      : null;
  const rawUrls = Array.isArray(input.urls) ? input.urls : [];
  const urls = Array.from(
    new Set(
      rawUrls
        .filter((value): value is string => typeof value === "string")
        .map(normalizeUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ).slice(0, MAX_URLS);

  if (urls.length === 0) {
    return {
      ok: false,
      error:
        "Paste at least one davidmallick.dev URL. You can copy the affected URLs from the GSC issue detail view.",
    };
  }

  const current = (await getCoverageSnapshot()) ?? emptyCoverageSnapshot();
  const results: CoverageUrlCheck[] = [];
  const errors: string[] = [];

  for (let index = 0; index < urls.length; index += INSPECT_CONCURRENCY) {
    const batch = urls.slice(index, index + INSPECT_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (url) => {
        const result = await inspectUrl(url);
        return {
          url,
          issueReason,
          checkedAt: new Date().toISOString(),
          verdict: result.verdict,
          coverageState: result.coverageState,
          lastCrawlTime: result.lastCrawlTime,
          pageFetchState: result.pageFetchState,
          indexingState: result.indexingState,
          googleCanonical: result.googleCanonical,
          userCanonical: result.userCanonical,
          error: null,
        } satisfies CoverageUrlCheck;
      }),
    );

    for (let offset = 0; offset < settled.length; offset += 1) {
      const outcome = settled[offset];
      const url = batch[offset];

      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
        continue;
      }

      const error: unknown = outcome.reason;
      const message =
        error instanceof GscAuthError || error instanceof GscNotConnectedError
          ? error.message
          : error instanceof Error
            ? error.message
            : "URL inspection failed.";
      errors.push(`${url}: ${message}`);
      results.push({
        url,
        issueReason,
        checkedAt: new Date().toISOString(),
        verdict: null,
        coverageState: null,
        lastCrawlTime: null,
        pageFetchState: null,
        indexingState: null,
        googleCanonical: null,
        userCanonical: null,
        error: message.slice(0, 1000),
      });
    }

    if (index + INSPECT_CONCURRENCY < urls.length) {
      await delay(INSPECT_DELAY_MS);
    }
  }

  const fresh = new Map(results.map((result) => [result.url, result]));
  const mergedUrls = [
    ...results,
    ...current.urls.filter((entry) => !fresh.has(entry.url)),
  ].slice(0, 300);
  const lastInspectedAt = new Date().toISOString();

  await setSetting(SETTINGS_KEYS.coverageSnapshot, {
    ...current,
    urls: mergedUrls,
    lastInspectedAt,
  });

  revalidatePath("/admin/search-console");

  return {
    ok: true,
    checked: results.length,
    errors,
    results,
  };
}
