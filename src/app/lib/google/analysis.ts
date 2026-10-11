import { z } from "zod";
import { buildAuthorProfile } from "@/app/lib/ai/blog-prompt";
import { callModel } from "@/app/lib/ai/call-model";
import { extractJsonObject } from "@/app/lib/ai/opencode-go";
import {
  getPrompt,
  PROMPT_KEYS,
  PROMPT_REGISTRY,
  renderPrompt,
} from "@/app/lib/ai/prompts";
import { getAnalysisSettings } from "@/app/lib/settings";
import {
  fetchByDimension,
  fetchTotals,
  type GscDateRange,
  type GscRow,
} from "./search-console";

export interface AnalysisPriority {
  title: string;
  why: string;
  action: string;
  impact: "high" | "medium" | "low";
}

export interface AnalysisQuickWin {
  title: string;
  action: string;
}

export interface AnalysisBody {
  summary: string;
  priorities: AnalysisPriority[];
  quickWins: AnalysisQuickWin[];
}

export interface AnalysisRunResult {
  analysis: AnalysisBody;
  model: string;
  generatedAt: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

const analysisSchema = z.object({
  summary: z.string().min(20).max(2500),
  priorities: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        why: z.string().min(5).max(1500),
        action: z.string().min(3).max(1500),
        impact: z.enum(["high", "medium", "low"]).catch("medium"),
      }),
    )
    .min(1)
    .max(12),
  quickWins: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        action: z.string().min(3).max(1000),
      }),
    )
    .max(10)
    .catch([]),
});

const numberFormat = new Intl.NumberFormat("en-US");

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inclusiveDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function previousRange(range: GscDateRange): GscDateRange {
  const start = parseIsoDay(range.startDate);
  const end = parseIsoDay(range.endDate);
  if (!start || !end) return range;

  const length = inclusiveDays(start, end);
  const previousEnd = addDays(start, -1);
  return {
    startDate: isoDay(addDays(previousEnd, -(length - 1))),
    endDate: isoDay(previousEnd),
  };
}

function formatCtr(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPosition(value: number): string {
  return value.toFixed(1);
}

function formatRow(row: GscRow, label: string): string {
  return `${label} | clicks ${numberFormat.format(row.clicks)} | impressions ${numberFormat.format(row.impressions)} | ctr ${formatCtr(row.ctr)} | position ${formatPosition(row.position)}`;
}

function formatDelta(current: number, previous: number, suffix = ""): string {
  const difference = current - previous;
  const sign = difference >= 0 ? "+" : "";
  if (previous === 0) {
    return current === 0 ? "no change" : "new";
  }
  const percent = (difference / previous) * 100;
  return `${sign}${percent.toFixed(1)}%${suffix}`;
}

function formatPointDelta(current: number, previous: number): string {
  const difference = current - previous;
  const sign = difference >= 0 ? "+" : "";
  return `${sign}${(difference * 100).toFixed(2)} pp`;
}

function formatAbsoluteDelta(current: number, previous: number): string {
  const difference = current - previous;
  const sign = difference >= 0 ? "+" : "";
  return `${sign}${difference.toFixed(1)}`;
}

function splitLine(items: GscRow[]): string {
  if (items.length === 0) return "none";
  return items
    .map((row) => `${row.keys[0] ?? "(not set)"} ${numberFormat.format(row.clicks)}`)
    .join(", ");
}

export async function runSearchAnalysis(
  range: GscDateRange,
): Promise<AnalysisRunResult> {
  const previous = previousRange(range);

  const [
    totals,
    previousTotals,
    topQueries,
    topPages,
    queryCandidates,
    devices,
    countries,
  ] = await Promise.all([
    fetchTotals(range),
    fetchTotals(previous),
    fetchByDimension("query", range, 10),
    fetchByDimension("page", range, 10),
    fetchByDimension("query", range, 250),
    fetchByDimension("device", range, 10),
    fetchByDimension("country", range, 10),
  ]);

  const striking = queryCandidates
    .filter(
      (row) => row.position >= 5 && row.position <= 20 && row.impressions >= 50,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);

  const ctrOutliers = queryCandidates
    .filter((row) => row.impressions >= 200 && row.ctr < 0.01)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  const days = inclusiveDays(
    parseIsoDay(range.startDate) ?? new Date(),
    parseIsoDay(range.endDate) ?? new Date(),
  );

  const gscSummary = [
    `Range: ${range.startDate} to ${range.endDate} (${days} days).`,
    `Previous equal-length range: ${previous.startDate} to ${previous.endDate}.`,
    `Clicks: ${numberFormat.format(totals.clicks)} (previous ${numberFormat.format(previousTotals.clicks)}, ${formatDelta(totals.clicks, previousTotals.clicks)}).`,
    `Impressions: ${numberFormat.format(totals.impressions)} (previous ${numberFormat.format(previousTotals.impressions)}, ${formatDelta(totals.impressions, previousTotals.impressions)}).`,
    `CTR: ${formatCtr(totals.ctr)} (previous ${formatCtr(previousTotals.ctr)}, ${formatPointDelta(totals.ctr, previousTotals.ctr)}).`,
    `Average position: ${formatPosition(totals.position)} (previous ${formatPosition(previousTotals.position)}, ${formatAbsoluteDelta(totals.position, previousTotals.position)}).`,
    `Top devices by clicks: ${splitLine(devices)}.`,
    `Top countries by clicks: ${splitLine(countries)}.`,
  ].join("\n");

  const gscQueries =
    topQueries.length > 0
      ? topQueries.map((row) => formatRow(row, row.keys[0] ?? "(not set)")).join("\n")
      : "No query rows in this range.";

  const gscPages =
    topPages.length > 0
      ? topPages.map((row) => formatRow(row, row.keys[0] ?? "(not set)")).join("\n")
      : "No page rows in this range.";

  const strikingText =
    striking.length > 0
      ? striking
          .map(
            (row) =>
              `${row.keys[0] ?? "(not set)"} | impressions ${numberFormat.format(row.impressions)} | position ${formatPosition(row.position)} | ctr ${formatCtr(row.ctr)}`,
          )
          .join("\n")
      : "No striking-distance queries above the impressions threshold.";

  const outliersText =
    ctrOutliers.length > 0
      ? ctrOutliers
          .map(
            (row) =>
              `${row.keys[0] ?? "(not set)"} | impressions ${numberFormat.format(row.impressions)} | ctr ${formatCtr(row.ctr)} | position ${formatPosition(row.position)}`,
          )
          .join("\n")
      : "No high-impression queries below 1 percent CTR.";

  const gscStriking = [
    "STRIKING DISTANCE (position 5 to 20, impressions at or above 50)",
    strikingText,
    "",
    "CTR OUTLIERS (impressions at or above 200, CTR below 1 percent)",
    outliersText,
  ].join("\n");

  const settings = await getAnalysisSettings();
  const definition = PROMPT_REGISTRY[PROMPT_KEYS.analysis];
  const template = await getPrompt(PROMPT_KEYS.analysis);

  const messages = renderPrompt(definition, template, {
    today: isoDay(new Date()),
    range: `${range.startDate} to ${range.endDate} (${days} days)`,
    gscSummary,
    gscQueries,
    gscPages,
    gscStriking,
    siteContext: buildAuthorProfile(),
  });

  const result = await callModel({
    modelId: settings.modelId,
    messages,
    sessionId: `gsc-analysis-${Date.now()}`,
    maxTokens: 6000,
    temperature: 0.2,
    reasoningEffort: settings.reasoningEffort,
    timeoutMs: 120_000,
    jsonMode: true,
  });

  const parsed = analysisSchema.safeParse(extractJsonObject(result.content));
  if (!parsed.success) {
    throw new Error(
      "The analysis model returned a response that did not match the expected contract.",
    );
  }

  return {
    analysis: parsed.data,
    model: settings.modelId,
    generatedAt: new Date().toISOString(),
    ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
    ...(result.outputTokens !== undefined
      ? { outputTokens: result.outputTokens }
      : {}),
    ...(result.cost !== undefined ? { cost: result.cost } : {}),
  };
}
