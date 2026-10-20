import { z } from "zod";
import { parseCsv } from "./csv";

export const COVERAGE_RESOLUTIONS = [
  "open",
  "intentional",
  "fixing",
  "resolved",
] as const;

export type CoverageResolution = (typeof COVERAGE_RESOLUTIONS)[number];

export const coverageIssueSchema = z.object({
  reason: z.string().min(1).max(300),
  source: z.string().max(100).catch(""),
  validation: z.string().max(100).catch(""),
  pages: z.number().int().nonnegative().catch(0),
  resolution: z.enum(COVERAGE_RESOLUTIONS).catch("open"),
  note: z.string().max(500).nullish(),
  updatedAt: z.string().nullish(),
});

export type CoverageIssue = z.infer<typeof coverageIssueSchema>;

export const coverageUrlCheckSchema = z.object({
  url: z.string().min(1).max(2000),
  issueReason: z.string().max(300).nullish(),
  checkedAt: z.string(),
  verdict: z.string().max(200).nullish(),
  coverageState: z.string().max(300).nullish(),
  lastCrawlTime: z.string().max(100).nullish(),
  pageFetchState: z.string().max(200).nullish(),
  indexingState: z.string().max(200).nullish(),
  googleCanonical: z.string().max(2000).nullish(),
  userCanonical: z.string().max(2000).nullish(),
  error: z.string().max(1000).nullish(),
});

export type CoverageUrlCheck = z.infer<typeof coverageUrlCheckSchema>;

export const coverageSnapshotSchema = z.object({
  importedAt: z.string().nullish(),
  issues: z.array(coverageIssueSchema).max(200).catch([]),
  urls: z.array(coverageUrlCheckSchema).max(300).catch([]),
  lastInspectedAt: z.string().nullish(),
});

export type CoverageSnapshot = z.infer<typeof coverageSnapshotSchema>;

export function emptyCoverageSnapshot(): CoverageSnapshot {
  return {
    importedAt: null,
    issues: [],
    urls: [],
    lastInspectedAt: null,
  };
}

export function normalizeCoverageIssueReason(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 300);
}

export function parseCoverageCsv(text: string): CoverageIssue[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const reasonIndex = header.findIndex((cell) => cell === "reason");
  const sourceIndex = header.findIndex((cell) => cell === "source");
  const validationIndex = header.findIndex((cell) => cell === "validation");
  const pagesIndex = header.findIndex(
    (cell) => cell === "pages" || cell === "pages affected",
  );

  if (reasonIndex === -1) return [];

  const merged = new Map<string, CoverageIssue>();

  for (const row of rows.slice(1)) {
    const reason = normalizeCoverageIssueReason(row[reasonIndex] ?? "");
    if (!reason) continue;

    const pagesValue = Number(
      (row[pagesIndex] ?? "").replace(/[^\d]/g, ""),
    );
    const pages = Number.isFinite(pagesValue) ? pagesValue : 0;
    const existing = merged.get(reason);

    if (existing) {
      existing.pages += pages;
      continue;
    }

    merged.set(reason, {
      reason,
      source: (row[sourceIndex] ?? "").trim().slice(0, 100),
      validation: (row[validationIndex] ?? "").trim().slice(0, 100),
      pages,
      resolution: "open",
      note: null,
      updatedAt: null,
    });
  }

  return [...merged.values()].slice(0, 200);
}

export function mergeCoverageIssues(
  existing: CoverageIssue[],
  imported: CoverageIssue[],
): CoverageIssue[] {
  const previous = new Map(existing.map((issue) => [issue.reason, issue]));
  const next = new Map<string, CoverageIssue>();

  for (const issue of imported) {
    const old = previous.get(issue.reason);
    next.set(issue.reason, {
      ...issue,
      resolution: old?.resolution ?? "open",
      note: old?.note ?? null,
      updatedAt: old?.updatedAt ?? null,
    });
  }

  for (const issue of existing) {
    if (!next.has(issue.reason)) {
      next.set(issue.reason, issue);
    }
  }

  return [...next.values()].slice(0, 200);
}
