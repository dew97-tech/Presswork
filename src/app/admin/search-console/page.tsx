import LineChart from "@/components/ui/line-chart";
import { getGoogleConnectionSummary } from "@/app/lib/google/oauth";
import {
  fetchByDimension,
  fetchTimeseries,
  fetchTotals,
  GscApiError,
  GscAuthError,
  GscNotConnectedError,
  isGscConnected,
  type GscFilter,
  type GscRow,
  type GscTotals,
} from "@/app/lib/google/search-console";
import prisma from "@/app/lib/prisma";
import {
  getGscProperty,
  getLastAnalysis,
  getLastIndexSyncAt,
  type LastAnalysis,
} from "@/app/lib/settings";
import SearchAnalysisPanel from "@/app/ui/search-analysis-panel";
import SyncIndexButton from "@/app/ui/sync-index-button";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  CaretRight,
  WarningCircle,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LAG_DAYS = 3;

const TABS = [
  { id: "queries", label: "Queries" },
  { id: "pages", label: "Pages" },
  { id: "countries", label: "Countries" },
  { id: "devices", label: "Devices" },
  { id: "index", label: "Index status" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type SortKey = "clicks" | "impressions" | "ctr" | "position";

interface ResolvedRange {
  preset: "7" | "28" | "90" | "custom";
  startDate: string;
  endDate: string;
}

interface BannerState {
  kind: "not-connected" | "auth" | "api";
  message?: string;
}

interface IndexRow {
  id: string;
  slug: string;
  title: string;
  indexStatus: string | null;
  indexedAt: Date | null;
}

const numberFormat = new Intl.NumberFormat("en-US");

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inclusiveDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function resolveRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): ResolvedRange {
  const today = new Date(`${isoDay(new Date())}T00:00:00Z`);
  const latestAllowed = addDays(today, -LAG_DAYS);

  if (params.range === "custom") {
    const from = parseIsoDay(params.from);
    const rawTo = parseIsoDay(params.to) ?? latestAllowed;
    const to = rawTo.getTime() > latestAllowed.getTime() ? latestAllowed : rawTo;
    if (from && from.getTime() <= to.getTime()) {
      return { preset: "custom", startDate: isoDay(from), endDate: isoDay(to) };
    }
  }

  const preset = params.range === "7" || params.range === "90" ? params.range : "28";
  const span = Number(preset);
  return {
    preset,
    startDate: isoDay(addDays(latestAllowed, -(span - 1))),
    endDate: isoDay(latestAllowed),
  };
}

function previousRange(range: ResolvedRange): {
  startDate: string;
  endDate: string;
} {
  const start = parseIsoDay(range.startDate);
  const end = parseIsoDay(range.endDate);
  if (!start || !end) {
    return { startDate: range.startDate, endDate: range.endDate };
  }
  const length = inclusiveDays(start, end);
  const previousEnd = addDays(start, -1);
  return {
    startDate: isoDay(addDays(previousEnd, -(length - 1))),
    endDate: isoDay(previousEnd),
  };
}

function hrefWith(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `/admin/search-console${query ? `?${query}` : ""}`;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPosition(value: number): string {
  return value.toFixed(1);
}

function sortRows(rows: GscRow[], sort: SortKey, dir: "asc" | "desc"): GscRow[] {
  return [...rows].sort((a, b) =>
    dir === "asc" ? a[sort] - b[sort] : b[sort] - a[sort],
  );
}

function isIndexedStatus(status: string | null): boolean {
  if (!status) return false;
  return /indexed/i.test(status) && !/not indexed/i.test(status);
}

function isTab(value: string | undefined): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

function dimensionForTab(tab: TabId): "query" | "page" | "country" | "device" | null {
  if (tab === "queries") return "query";
  if (tab === "pages") return "page";
  if (tab === "countries") return "country";
  if (tab === "devices") return "device";
  return null;
}

function Banner({
  tone,
  eyebrow,
  title,
  children,
}: {
  tone: "info" | "danger";
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-5 py-4",
        tone === "danger" ? "border-l-2 border-l-danger" : "border-l-2 border-l-ink-faint",
      )}
    >
      <div className="flex items-start gap-3">
        <WarningCircle
          size={16}
          weight="fill"
          aria-hidden="true"
          className={cn(
            "mt-0.5 shrink-0",
            tone === "danger" ? "text-danger" : "text-ink-faint",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-faint">{eyebrow}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{title}</p>
          {children ? (
            <div className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  deltaGood,
  deltaLabel,
}: {
  label: string;
  value: string;
  delta: number | null;
  deltaGood: boolean | null;
  deltaLabel: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <p className="eyebrow text-ink-faint">{label}</p>
      <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {delta !== null && deltaLabel !== null ? (
        <p
          className={cn(
            "mt-1 flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em]",
            deltaGood === null
              ? "text-ink-faint"
              : deltaGood
                ? "text-ok"
                : "text-danger",
          )}
        >
          {delta > 0 ? (
            <ArrowUp size={11} aria-hidden="true" />
          ) : delta < 0 ? (
            <ArrowDown size={11} aria-hidden="true" />
          ) : null}
          <span>{deltaLabel}</span>
        </p>
      ) : null}
    </div>
  );
}

function TableHeaderLink({
  label,
  sortKey,
  activeSort,
  dir,
  baseParams,
  numeric = true,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortKey;
  dir: "asc" | "desc";
  baseParams: Record<string, string | undefined>;
  numeric?: boolean;
}) {
  const isActive = sortKey === activeSort;
  const nextDir = isActive && dir === "desc" ? "asc" : "desc";
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 font-normal", numeric && "text-right")}
    >
      <Link
        href={hrefWith({
          ...baseParams,
          sort: sortKey,
          dir: nextDir,
        })}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          isActive && "text-foreground",
        )}
      >
        <span>{label}</span>
        {isActive ? (
          dir === "desc" ? (
            <ArrowDown size={10} aria-hidden="true" />
          ) : (
            <ArrowUp size={10} aria-hidden="true" />
          )
        ) : null}
      </Link>
    </th>
  );
}

function DataTable({
  rows,
  tab,
  sort,
  dir,
  baseParams,
  linkMode,
}: {
  rows: GscRow[];
  tab: TabId;
  sort: SortKey;
  dir: "asc" | "desc";
  baseParams: Record<string, string | undefined>;
  linkMode: "query" | "page" | null;
}) {
  const sorted = sortRows(rows, sort, dir);
  const label =
    tab === "queries"
      ? "Query"
      : tab === "pages"
        ? "Page"
        : tab === "countries"
          ? "Country"
          : "Device";

  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-[13px] text-ink-muted">
            <th scope="col" className="px-4 py-3 font-normal">
              {label}
            </th>
            <TableHeaderLink
              label="Clicks"
              sortKey="clicks"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <TableHeaderLink
              label="Impressions"
              sortKey="impressions"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <TableHeaderLink
              label="CTR"
              sortKey="ctr"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <TableHeaderLink
              label="Position"
              sortKey="position"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-14 text-center text-sm text-ink-muted"
              >
                No rows for this range.
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const key = row.keys[0] ?? "(not set)";
              const cell = (
                <span className="break-all text-foreground">{key}</span>
              );
              const targetTab: TabId | null =
                linkMode === "query" ? "pages" : linkMode === "page" ? "queries" : null;

              return (
                <tr key={key} className="group transition-colors hover:bg-accent/40">
                  <td className="px-4 py-3 text-sm">
                    {linkMode && targetTab ? (
                      <Link
                        href={hrefWith({
                          ...baseParams,
                          tab: targetTab,
                          [linkMode]: key,
                          sort: undefined,
                          dir: undefined,
                        })}
                        title={
                          linkMode === "query"
                            ? `Show pages for "${key}"`
                            : "Show queries for this page"
                        }
                        className="inline-flex items-center gap-1 underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-border hover:decoration-border"
                      >
                        {cell}
                        <CaretRight
                          size={11}
                          aria-hidden="true"
                          className="shrink-0 text-ink-faint"
                        />
                      </Link>
                    ) : (
                      cell
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-muted">
                    {numberFormat.format(row.clicks)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-muted">
                    {numberFormat.format(row.impressions)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-muted">
                    {formatPercent(row.ctr)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-muted">
                    {formatPosition(row.position)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

async function loadIndexRows(): Promise<IndexRow[]> {
  return prisma.post.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      indexStatus: true,
      indexedAt: true,
    },
  });
}

export default async function SearchConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const range = resolveRange({
    range: firstValue(params.range),
    from: firstValue(params.from),
    to: firstValue(params.to),
  });
  const tabParam = firstValue(params.tab);
  const tab: TabId = isTab(tabParam) ? tabParam : "queries";
  const compare = firstValue(params.compare) === "1";
  const queryFilter = firstValue(params.query)?.slice(0, 200);
  const pageFilter = firstValue(params.page)?.slice(0, 500);
  const sortParam = firstValue(params.sort);
  const sort: SortKey =
    sortParam === "impressions" || sortParam === "ctr" || sortParam === "position"
      ? sortParam
      : "clicks";
  const dir = firstValue(params.dir) === "asc" ? "asc" : "desc";

  const [property, connection] = await Promise.all([
    getGscProperty(),
    getGoogleConnectionSummary(),
  ]);

  const baseParams: Record<string, string | undefined> = {
    range: range.preset === "28" ? undefined : range.preset,
    from: range.preset === "custom" ? range.startDate : undefined,
    to: range.preset === "custom" ? range.endDate : undefined,
    tab: tab === "queries" ? undefined : tab,
    compare: compare ? "1" : undefined,
    query: queryFilter,
    page: pageFilter,
  };

  let banner: BannerState | null = null;
  let totals: GscTotals | null = null;
  let previousTotals: GscTotals | null = null;
  let timeseries: GscRow[] = [];
  let rows: GscRow[] = [];
  let indexRows: IndexRow[] | null = null;
  let lastIndexSyncAt: string | null = null;
  let lastAnalysis: LastAnalysis | null = null;

  if (!(await isGscConnected())) {
    banner = { kind: "not-connected" };
  } else {
    try {
      const filters: GscFilter[] = [];
      if (tab === "pages" && queryFilter) {
        filters.push({
          dimension: "query",
          operator: "contains",
          expression: queryFilter,
        });
      }
      if (tab === "queries" && pageFilter) {
        filters.push({
          dimension: "page",
          operator: "equals",
          expression: pageFilter,
        });
      }

      const dimension = dimensionForTab(tab);

      const [
        fetchedTotals,
        fetchedTimeseries,
        fetchedRows,
        fetchedPreviousTotals,
        fetchedIndexRows,
        fetchedLastSync,
        fetchedLastAnalysis,
      ] = await Promise.all([
        fetchTotals(range),
        fetchTimeseries(range),
        dimension
          ? fetchByDimension(dimension, range, 50, filters)
          : Promise.resolve([]),
        compare ? fetchTotals(previousRange(range)) : Promise.resolve(null),
        tab === "index" ? loadIndexRows() : Promise.resolve(null),
        tab === "index" ? getLastIndexSyncAt() : Promise.resolve(null),
        getLastAnalysis(),
      ]);

      totals = fetchedTotals;
      timeseries = fetchedTimeseries;
      rows = fetchedRows;
      previousTotals = fetchedPreviousTotals;
      indexRows = fetchedIndexRows;
      lastIndexSyncAt = fetchedLastSync;
      lastAnalysis = fetchedLastAnalysis;
    } catch (error) {
      if (error instanceof GscNotConnectedError) {
        banner = { kind: "not-connected" };
      } else if (error instanceof GscAuthError) {
        banner = { kind: "auth", message: error.message };
      } else if (error instanceof GscApiError) {
        banner = { kind: "api", message: error.message };
      } else {
        throw error;
      }
    }
  }

  const indexedCount = indexRows?.filter((row) => isIndexedStatus(row.indexStatus)).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="eyebrow text-ink-faint">{property}</p>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-serif text-2xl tracking-[-0.01em] text-foreground">
            Search Console
          </h1>
          {connection.connected ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              {connection.email ?? "connected"}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-ink-muted">
          Data ends {LAG_DAYS} days ago because Search Console reporting lags.
          Ranges: {range.startDate} to {range.endDate}.
        </p>
      </header>

      {banner ? (
        banner.kind === "not-connected" ? (
          <Banner
            tone="info"
            eyebrow="Not connected"
            title="Connect a Google account to load Search Console data."
          >
            <p>
              Add the OAuth client and connect from{" "}
              <Link
                href="/admin/settings"
                className="underline decoration-1 underline-offset-4 hover:text-foreground"
              >
                Settings
              </Link>
              . Blog generation still uses the service account or skips Search
              Console demand when it is not configured.
            </p>
          </Banner>
        ) : banner.kind === "auth" ? (
          <Banner
            tone="danger"
            eyebrow="Reconnect needed"
            title={banner.message ?? "Google authorization expired."}
          >
            <p>
              <Link
                href="/admin/settings"
                className="underline decoration-1 underline-offset-4 hover:text-foreground"
              >
                Reconnect the Google account
              </Link>{" "}
              to continue.
            </p>
          </Banner>
        ) : (
          <Banner
            tone="danger"
            eyebrow="Google API error"
            title={banner.message ?? "Search Console request failed."}
          >
            <p>Reload to retry. If it persists, check the property access.</p>
          </Banner>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex rounded border border-border"
              role="group"
              aria-label="Date range"
            >
              {(["7", "28", "90"] as const).map((preset, index) => {
                const active = range.preset === preset;
                return (
                  <Link
                    key={preset}
                    href={hrefWith({
                      ...baseParams,
                      range: preset === "28" ? undefined : preset,
                      from: undefined,
                      to: undefined,
                    })}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
                      index === 0 ? "rounded-l" : index === 2 ? "rounded-r" : "",
                      index > 0 && "border-l border-border",
                      active
                        ? "bg-accent text-foreground"
                        : "text-ink-muted hover:text-foreground",
                    )}
                  >
                    {preset} days
                  </Link>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={hrefWith({
                  ...baseParams,
                  compare: compare ? undefined : "1",
                })}
                aria-pressed={compare}
                className={cn(
                  "inline-flex h-9 items-center rounded border px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
                  compare
                    ? "border-border bg-accent text-foreground"
                    : "border-border text-ink-muted hover:text-foreground",
                )}
              >
                Compare previous
              </Link>

              <details className="relative">
                <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded border border-border px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                  Custom range
                </summary>
                <form
                  method="get"
                  className="absolute right-0 z-30 mt-2 flex flex-wrap items-end gap-2 rounded border border-border bg-card p-3"
                >
                  <input type="hidden" name="range" value="custom" />
                  {tab !== "queries" ? (
                    <input type="hidden" name="tab" value={tab} />
                  ) : null}
                  {compare ? <input type="hidden" name="compare" value="1" /> : null}
                  {queryFilter ? (
                    <input type="hidden" name="query" value={queryFilter} />
                  ) : null}
                  {pageFilter ? (
                    <input type="hidden" name="page" value={pageFilter} />
                  ) : null}
                  <label className="block text-[13px] text-ink-muted">
                    <span className="eyebrow block text-ink-faint">From</span>
                    <input
                      type="date"
                      name="from"
                      defaultValue={range.startDate}
                      className="mt-1 block h-10 rounded border border-input bg-surface px-2 font-mono text-[13px] text-foreground"
                    />
                  </label>
                  <label className="block text-[13px] text-ink-muted">
                    <span className="eyebrow block text-ink-faint">To</span>
                    <input
                      type="date"
                      name="to"
                      defaultValue={range.endDate}
                      className="mt-1 block h-10 rounded border border-input bg-surface px-2 font-mono text-[13px] text-foreground"
                    />
                  </label>
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center rounded bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-[var(--clay-deep-hover)]"
                  >
                    Apply
                  </button>
                </form>
              </details>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Clicks"
              value={numberFormat.format(totals?.clicks ?? 0)}
              delta={
                compare && previousTotals
                  ? (totals?.clicks ?? 0) - previousTotals.clicks
                  : null
              }
              deltaGood={
                compare && previousTotals
                  ? (totals?.clicks ?? 0) >= previousTotals.clicks
                  : null
              }
              deltaLabel={
                compare && previousTotals
                  ? previousTotals.clicks === 0
                    ? totals?.clicks
                      ? "new"
                      : "0"
                    : `${(((totals?.clicks ?? 0) - previousTotals.clicks) / previousTotals.clicks * 100).toFixed(1)}%`
                  : null
              }
            />
            <KpiCard
              label="Impressions"
              value={numberFormat.format(totals?.impressions ?? 0)}
              delta={
                compare && previousTotals
                  ? (totals?.impressions ?? 0) - previousTotals.impressions
                  : null
              }
              deltaGood={
                compare && previousTotals
                  ? (totals?.impressions ?? 0) >= previousTotals.impressions
                  : null
              }
              deltaLabel={
                compare && previousTotals
                  ? previousTotals.impressions === 0
                    ? totals?.impressions
                      ? "new"
                      : "0"
                    : `${(((totals?.impressions ?? 0) - previousTotals.impressions) / previousTotals.impressions * 100).toFixed(1)}%`
                  : null
              }
            />
            <KpiCard
              label="CTR"
              value={formatPercent(totals?.ctr ?? 0)}
              delta={
                compare && previousTotals
                  ? (totals?.ctr ?? 0) - previousTotals.ctr
                  : null
              }
              deltaGood={
                compare && previousTotals
                  ? (totals?.ctr ?? 0) >= previousTotals.ctr
                  : null
              }
              deltaLabel={
                compare && previousTotals
                  ? `${((totals?.ctr ?? 0) - previousTotals.ctr) * 100 >= 0 ? "+" : ""}${(((totals?.ctr ?? 0) - previousTotals.ctr) * 100).toFixed(2)} pp`
                  : null
              }
            />
            <KpiCard
              label="Average position"
              value={formatPosition(totals?.position ?? 0)}
              delta={
                compare && previousTotals
                  ? (totals?.position ?? 0) - previousTotals.position
                  : null
              }
              deltaGood={
                compare && previousTotals
                  ? (totals?.position ?? 0) <= previousTotals.position
                  : null
              }
              deltaLabel={
                compare && previousTotals
                  ? `${((totals?.position ?? 0) - previousTotals.position) >= 0 ? "+" : ""}${((totals?.position ?? 0) - previousTotals.position).toFixed(1)}`
                  : null
              }
            />
          </div>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-lg tracking-[-0.01em] text-foreground">
                Clicks and impressions
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                {range.startDate} to {range.endDate}
              </span>
            </div>
            <div className="mt-4">
              <LineChart
                points={timeseries.map((row) => ({
                  label: row.keys[0] ?? "",
                  a: row.clicks,
                  b: row.impressions,
                }))}
                labels={["Clicks", "Impressions"]}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <nav className="flex flex-wrap items-center gap-4" aria-label="Search Console views">
                {TABS.map((item) => {
                  const active = item.id === tab;
                  return (
                    <Link
                      key={item.id}
                      href={hrefWith({
                        ...baseParams,
                        tab: item.id === "queries" ? undefined : item.id,
                        query: queryFilter,
                        page: pageFilter,
                        sort: undefined,
                        dir: undefined,
                      })}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "text-sm transition-colors hover:text-foreground",
                        active
                          ? "text-foreground underline decoration-1 underline-offset-4"
                          : "text-ink-muted",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              {tab === "pages" && queryFilter ? (
                <span className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
                    query contains &quot;{queryFilter}&quot;
                  </span>
                  <Link
                    href={hrefWith({
                      ...baseParams,
                      query: undefined,
                      sort: undefined,
                      dir: undefined,
                    })}
                    className="underline decoration-1 underline-offset-4 hover:text-foreground"
                  >
                    Clear
                  </Link>
                </span>
              ) : null}
              {tab === "queries" && pageFilter ? (
                <span className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
                    page is {pageFilter}
                  </span>
                  <Link
                    href={hrefWith({
                      ...baseParams,
                      page: undefined,
                      sort: undefined,
                      dir: undefined,
                    })}
                    className="underline decoration-1 underline-offset-4 hover:text-foreground"
                  >
                    Clear
                  </Link>
                </span>
              ) : null}
            </div>

            {tab === "index" ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                    {indexedCount} of {indexRows?.length ?? 0} published posts
                    report as indexed
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                      {lastIndexSyncAt
                        ? `last sync ${lastIndexSyncAt.slice(0, 16).replace("T", " ")} UTC`
                        : "never synced"}
                    </span>
                    <SyncIndexButton />
                  </div>
                </div>
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border text-[13px] text-ink-muted">
                        <th scope="col" className="px-4 py-3 font-normal">
                          Article
                        </th>
                        <th scope="col" className="px-4 py-3 font-normal">
                          Index status
                        </th>
                        <th scope="col" className="px-4 py-3 font-normal">
                          Last crawl
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(indexRows ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-4 py-14 text-center text-sm text-ink-muted"
                          >
                            No published posts.
                          </td>
                        </tr>
                      ) : (
                        (indexRows ?? []).map((post) => (
                          <tr
                            key={post.id}
                            className="transition-colors hover:bg-accent/40"
                          >
                            <td className="px-4 py-3">
                              <Link
                                href={`/blog/${post.slug}`}
                                target="_blank"
                                className="text-sm text-foreground underline decoration-transparent underline-offset-4 transition-colors hover:decoration-border"
                              >
                                {post.title}
                              </Link>
                            </td>
                            <td className="px-4 py-3">
                              {post.indexStatus ? (
                                <span
                                  className={cn(
                                    "font-mono text-[11px] uppercase tracking-[0.08em]",
                                    isIndexedStatus(post.indexStatus)
                                      ? "text-ok"
                                      : "text-ink-muted",
                                  )}
                                >
                                  {post.indexStatus}
                                </span>
                              ) : (
                                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                                  not checked
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-ink-muted">
                              {post.indexedAt
                                ? post.indexedAt.toISOString().slice(0, 10)
                                : "unknown"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : dimensionForTab(tab) ? (
              <DataTable
                rows={rows}
                tab={tab}
                sort={sort}
                dir={dir}
                baseParams={baseParams}
                linkMode={
                  tab === "queries" ? "query" : tab === "pages" ? "page" : null
                }
              />
            ) : null}
          </section>

          <SearchAnalysisPanel
            initial={lastAnalysis}
            range={{
              preset: range.preset,
              startDate: range.startDate,
              endDate: range.endDate,
            }}
          />
        </>
      )}
    </div>
  );
}
