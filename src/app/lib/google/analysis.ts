import { z } from "zod";
import { buildAuthorProfile } from "@/app/lib/ai/blog-prompt";
import { callModel } from "@/app/lib/ai/call-model";
import { extractJsonObject } from "@/app/lib/ai/opencode-go";
import {
  findTemplateVariables,
  getPrompt,
  PROMPT_KEYS,
  PROMPT_REGISTRY,
  renderPrompt,
} from "@/app/lib/ai/prompts";
import {
  getAnalysisSettings,
  getPerformanceSnapshot,
} from "@/app/lib/settings";
import {
  fetchByDimension,
  fetchPageQueryPairs,
  fetchTotals,
  type GscDateRange,
  type GscRow,
} from "./search-console";

export interface AnalysisMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface AnalysisPriority {
  title: string;
  page?: string | null;
  section?: string | null;
  queries: string[];
  metrics?: AnalysisMetrics | null;
  why: string;
  action: string;
  impact: "high" | "medium" | "low";
}

export interface AnalysisQuickWin {
  title: string;
  page?: string | null;
  queries: string[];
  metrics?: AnalysisMetrics | null;
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

const analysisMetricsSchema = z.object({
  clicks: z.number().catch(0),
  impressions: z.number().catch(0),
  ctr: z.number().catch(0),
  position: z.number().catch(0),
});

const analysisSchema = z.object({
  summary: z.string().min(20).max(2500),
  priorities: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        page: z.string().max(1200).nullish().catch(null),
        section: z.string().max(300).nullish().catch(null),
        queries: z.array(z.string().min(1).max(300)).max(20).catch([]),
        metrics: analysisMetricsSchema.nullish().catch(null),
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
        page: z.string().max(1200).nullish().catch(null),
        queries: z.array(z.string().min(1).max(300)).max(20).catch([]),
        metrics: analysisMetricsSchema.nullish().catch(null),
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

function topRows(
  rows: GscRow[],
  key: "clicks" | "impressions" | "ctr" | "position",
  limit: number,
): GscRow[] {
  return [...rows].sort((a, b) => b[key] - a[key]).slice(0, limit);
}

function dedupeRows(rows: GscRow[]): GscRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.keys.join("\u0000");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatExportRows(
  rows: Array<{
    key: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>,
): string {
  return rows
    .map(
      (row) =>
        `${row.key} | clicks ${numberFormat.format(row.clicks)} | impressions ${numberFormat.format(row.impressions)} | ctr ${formatCtr(row.ctr)} | position ${formatPosition(row.position)}`,
    )
    .join("\n");
}

export async function runSearchAnalysis(
  range: GscDateRange,
): Promise<AnalysisRunResult> {
  const previous = previousRange(range);

  const [
    totals,
    previousTotals,
    queryRows,
    pageRows,
    pageQueryRows,
    devices,
    countries,
    performanceSnapshot,
  ] = await Promise.all([
    fetchTotals(range),
    fetchTotals(previous),
    fetchByDimension("query", range, 500),
    fetchByDimension("page", range, 500),
    fetchPageQueryPairs(range, 5000),
    fetchByDimension("device", range, 10),
    fetchByDimension("country", range, 10),
    getPerformanceSnapshot(),
  ]);

  const topQueriesByClicks = topRows(queryRows, "clicks", 12);
  const topQueriesByImpressions = topRows(queryRows, "impressions", 12);
  const topPagesByClicks = topRows(pageRows, "clicks", 12);
  const topPagesByImpressions = topRows(pageRows, "impressions", 12);

  const striking = queryRows
    .filter(
      (row) => row.position >= 5 && row.position <= 20 && row.impressions >= 30,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  const ctrOutliers = queryRows
    .filter((row) => row.impressions >= 50 && row.ctr < 0.01)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 12);

  const pageOpportunities = pageRows
    .filter(
      (row) =>
        row.impressions >= 25 && row.ctr < 0.02 && row.position <= 45,
    )
    .sort(
      (a, b) => b.impressions - a.impressions || a.ctr - b.ctr,
    )
    .slice(0, 15);

  const pageQueryGroups = new Map<string, GscRow[]>();
  for (const row of pageQueryRows) {
    const page = row.keys[0];
    if (!page) continue;
    const query = row.keys[1] ?? "(not set)";
    const list = pageQueryGroups.get(page) ?? [];
    list.push({ ...row, keys: [query] });
    pageQueryGroups.set(page, list);
  }

  const highlightedPages = dedupeRows([
    ...topPagesByClicks,
    ...topPagesByImpressions,
    ...pageOpportunities,
  ]);

  const pageQueryMap = highlightedPages
    .map((pageRow) => {
      const page = pageRow.keys[0] ?? "";
      const queries = [...(pageQueryGroups.get(page) ?? [])]
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
        .slice(0, 8);

      return [
        formatRow(pageRow, page),
        ...queries.map((query) => `  - ${formatRow(query, query.keys[0] ?? "(not set)")}`),
      ].join("\n");
    })
    .join("\n");

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

  const exportQueries = performanceSnapshot
    ? [...performanceSnapshot.queries]
        .sort(
          (a, b) =>
            b.impressions - a.impressions || b.clicks - a.clicks,
        )
        .slice(0, 20)
    : [];
  const exportPages = performanceSnapshot
    ? [...performanceSnapshot.pages]
        .sort(
          (a, b) =>
            b.impressions - a.impressions || b.clicks - a.clicks,
        )
        .slice(0, 20)
    : [];

  const gscQueries = [
    "API RANGE — TOP QUERIES BY CLICKS",
    topQueriesByClicks.length > 0
      ? topQueriesByClicks
          .map((row) => formatRow(row, row.keys[0] ?? "(not set)"))
          .join("\n")
      : "No query rows in this range.",
    "",
    "API RANGE — TOP QUERIES BY IMPRESSIONS",
    topQueriesByImpressions.length > 0
      ? topQueriesByImpressions
          .map((row) => formatRow(row, row.keys[0] ?? "(not set)"))
          .join("\n")
      : "No query rows in this range.",
    ...(performanceSnapshot && exportQueries.length > 0
      ? [
          "",
          `OFFICIAL EXPORT (imported ${performanceSnapshot.importedAt.slice(0, 10)}; different date range, do not compare totals with the API range) — TOP QUERIES BY IMPRESSIONS`,
          formatExportRows(exportQueries),
        ]
      : []),
  ].join("\n");

  const gscPages = [
    "API RANGE — TOP PAGES BY CLICKS",
    topPagesByClicks.length > 0
      ? topPagesByClicks
          .map((row) => formatRow(row, row.keys[0] ?? "(not set)"))
          .join("\n")
      : "No page rows in this range.",
    "",
    "API RANGE — TOP PAGES BY IMPRESSIONS",
    topPagesByImpressions.length > 0
      ? topPagesByImpressions
          .map((row) => formatRow(row, row.keys[0] ?? "(not set)"))
          .join("\n")
      : "No page rows in this range.",
    "",
    "HIGH IMPRESSION, LOW CTR PAGES (review these first)",
    pageOpportunities.length > 0
      ? pageOpportunities
          .map((row) => formatRow(row, row.keys[0] ?? "(not set)"))
          .join("\n")
      : "No pages meet the high-impression, low-CTR threshold.",
    "",
    "PAGE QUERY MAP (each page followed by its top queries in this range)",
    pageQueryMap || "No page-query pairs available for this range.",
    ...(performanceSnapshot && exportPages.length > 0
      ? [
          "",
          `OFFICIAL EXPORT (imported ${performanceSnapshot.importedAt.slice(0, 10)}; different date range, do not compare totals with the API range) — TOP PAGES BY IMPRESSIONS`,
          formatExportRows(exportPages),
        ]
      : []),
  ].join("\n");

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
    "STRIKING DISTANCE (position 5 to 20, impressions at or above 30)",
    strikingText,
    "",
    "CTR OUTLIERS (impressions at or above 50, CTR below 1 percent)",
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

  const templateVariables = new Set(
    findTemplateVariables(`${template.system}\n${template.user}`),
  );
  const missingSections: string[] = [];
  if (!templateVariables.has("gscQueries")) {
    missingSections.push(`TOP QUERIES\n${gscQueries}`);
  }
  if (!templateVariables.has("gscPages")) {
    missingSections.push(`TOP PAGES AND PAGE QUERY MAP\n${gscPages}`);
  }
  if (!templateVariables.has("gscStriking")) {
    missingSections.push(
      `STRIKING DISTANCE AND CTR OUTLIERS\n${gscStriking}`,
    );
  }

  if (missingSections.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      messages[messages.length - 1] = {
        ...lastMessage,
        content: `${lastMessage.content}\n\n${missingSections.join("\n\n")}`,
      };
    }
  }

  if (
    !template.system.includes('"page"') ||
    !template.system.includes('"section"') ||
    !template.system.includes('"queries"')
  ) {
    const systemMessage = messages[0];
    if (systemMessage) {
      messages[0] = {
        ...systemMessage,
        content: `${systemMessage.content}

ADDITIONAL OUTPUT REQUIREMENTS
Set "page" to the exact page URL the recommendation targets, or null for a content gap. Set "section" to the part of the page to change (title tag, meta description, a named H2 section, internal links, examples, or the whole article). Set "queries" to the query cluster that motivates the recommendation. Include "metrics" with clicks, impressions, ctr, and position when available.`,
      };
    }
  }

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
