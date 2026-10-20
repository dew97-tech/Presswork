import { z } from "zod";
import type { AnalysisBody } from "./analysis";

export type FeedbackKind = "priority" | "quickWin";

export interface FeedbackKeyParts {
  kind: FeedbackKind;
  index: number;
}

const reviewFocusMetricsSchema = z.object({
  clicks: z.number().catch(0),
  impressions: z.number().catch(0),
  ctr: z.number().catch(0),
  position: z.number().catch(0),
});

export const reviewFocusSchema = z.object({
  source: z.literal("gsc"),
  feedbackKey: z.string().min(1).max(80),
  analysisGeneratedAt: z.string().min(1).max(80),
  range: z.object({
    startDate: z.string().min(1).max(10),
    endDate: z.string().min(1).max(10),
  }),
  title: z.string().min(1).max(300),
  page: z.string().min(1).max(1200),
  section: z.string().max(300).nullish(),
  why: z.string().max(4000).catch(""),
  action: z.string().min(1).max(4000),
  impact: z.enum(["high", "medium", "low"]).catch("medium"),
  queries: z.array(z.string().min(1).max(300)).max(30).catch([]),
  metrics: reviewFocusMetricsSchema.nullish(),
});

export type ReviewFocus = z.infer<typeof reviewFocusSchema>;

export interface FeedbackReviewState {
  id: string;
  postId: string;
  status: string;
  createdAt: string;
  findingCount: number;
  errorCount: number;
  feedbackTitle: string;
}

export type FeedbackReviewMap = Record<string, FeedbackReviewState>;

export interface FeedbackReviewRow {
  id: string;
  postId: string;
  status: string;
  focus: unknown;
  findings: unknown;
  createdAt: Date | string;
}

export function makeFeedbackKey(kind: FeedbackKind, index: number): string {
  return `${kind}:${index}`;
}

export function parseFeedbackKey(value: string): FeedbackKeyParts | null {
  const match = /^(priority|quickWin):(\d{1,2})$/.exec(value.trim());
  if (!match) return null;

  const index = Number(match[2]);
  if (!Number.isInteger(index) || index < 0) return null;

  return { kind: match[1] as FeedbackKind, index };
}

export function extractBlogSlug(value: string | null | undefined): string | null {
  if (!value) return null;

  for (const match of value.matchAll(/\/blog\/([a-z0-9-]+)/gi)) {
    const slug = match[1].toLowerCase();
    if (slug === "tag" || slug === "page") continue;
    return slug;
  }

  return null;
}

export function buildReviewFocus(
  analysis: AnalysisBody,
  meta: {
    generatedAt: string;
    range: { startDate: string; endDate: string };
  },
  feedbackKey: string,
): ReviewFocus | null {
  const parsedKey = parseFeedbackKey(feedbackKey);
  if (!parsedKey) return null;

  let title: string;
  let page: string | null | undefined;
  let section: string | null = null;
  let why: string;
  let action: string;
  let impact: "high" | "medium" | "low";
  let queries: string[];
  let metrics: ReviewFocus["metrics"] = null;

  if (parsedKey.kind === "priority") {
    const priority = analysis.priorities[parsedKey.index];
    if (!priority) return null;
    title = priority.title;
    page = priority.page;
    section = priority.section ?? null;
    why = priority.why;
    action = priority.action;
    impact = priority.impact;
    queries = priority.queries ?? [];
    metrics = priority.metrics ?? null;
  } else {
    const win = analysis.quickWins[parsedKey.index];
    if (!win) return null;
    title = win.title;
    page = win.page;
    why = "Identified as a quick win in the Search Console analysis.";
    action = win.action;
    impact = "medium";
    queries = win.queries ?? [];
    metrics = win.metrics ?? null;
  }

  const searchable = [page, title, why, action].filter(Boolean).join(" ");
  const slug = extractBlogSlug(searchable);
  if (!slug) return null;

  const explicitSlug = extractBlogSlug(page);
  const resolvedPage =
    explicitSlug && page?.trim() ? page.trim() : `/blog/${slug}`;

  return {
    source: "gsc",
    feedbackKey,
    analysisGeneratedAt: meta.generatedAt,
    range: meta.range,
    title,
    page: resolvedPage,
    section,
    why,
    action,
    impact,
    queries,
    metrics,
  };
}

export function buildFeedbackReviewMap(
  rows: FeedbackReviewRow[],
  analysisGeneratedAt: string,
): FeedbackReviewMap {
  const map: FeedbackReviewMap = {};

  for (const row of rows) {
    const parsed = reviewFocusSchema.safeParse(row.focus);
    if (!parsed.success) continue;
    if (parsed.data.analysisGeneratedAt !== analysisGeneratedAt) continue;
    if (map[parsed.data.feedbackKey]) continue;

    const findings = Array.isArray(row.findings)
      ? (row.findings as Array<{ severity?: string }>)
      : [];
    const createdAt =
      row.createdAt instanceof Date
        ? row.createdAt
        : new Date(row.createdAt);

    map[parsed.data.feedbackKey] = {
      id: row.id,
      postId: row.postId,
      status: row.status,
      createdAt: Number.isNaN(createdAt.getTime())
        ? String(row.createdAt)
        : createdAt.toISOString(),
      findingCount: findings.length,
      errorCount: findings.filter((finding) => finding.severity === "error")
        .length,
      feedbackTitle: parsed.data.title,
    };
  }

  return map;
}

export function formatReviewFocus(focus: ReviewFocus): string {
  const metrics = focus.metrics
    ? `clicks ${focus.metrics.clicks} | impressions ${focus.metrics.impressions} | ctr ${(focus.metrics.ctr * 100).toFixed(2)}% | position ${focus.metrics.position.toFixed(1)}`
    : "not provided";

  return [
    `PAGE: ${focus.page}`,
    `SECTION TO IMPROVE: ${focus.section ?? "whole article"}`,
    `PRIORITY: ${focus.title}`,
    `WHY: ${focus.why}`,
    `REQUIRED ACTION: ${focus.action}`,
    `QUERY CLUSTER: ${focus.queries.length > 0 ? focus.queries.join(", ") : "not specified"}`,
    `METRICS (${focus.range.startDate} to ${focus.range.endDate}): ${metrics}`,
    `IMPACT: ${focus.impact}`,
  ].join("\n");
}
