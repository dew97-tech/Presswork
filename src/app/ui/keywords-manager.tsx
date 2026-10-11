"use client";

import {
  addKeyword,
  generateDraftFromKeyword,
  refreshKeywordMetrics,
  setKeywordStatus,
  syncKeywordIdeas,
} from "@/app/lib/keyword-actions";
import LineChart from "@/components/ui/line-chart";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowsClockwise,
  ArrowUp,
  CaretRight,
  CircleNotch,
  CopySimple,
  MagnifyingGlass,
  Plus,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";

export interface KeywordMonthlyVolume {
  year: number;
  month: string;
  monthlySearches: number;
}

export interface KeywordItem {
  id: string;
  keyword: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
  monthlyVolumes: KeywordMonthlyVolume[];
  source: string;
  status: string;
  postId: string | null;
  usedAt: string | null;
  fetchedAt: string | null;
  updatedAt: string;
}

type StatusFilter = "all" | "new" | "used" | "ignored";
type CompetitionFilter = "all" | "LOW" | "MEDIUM" | "HIGH";
type SortKey = "keyword" | "avgMonthlySearches" | "competitionIndex";
type SortDirection = "asc" | "desc";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://davidmallick.dev";
const numberFormat = new Intl.NumberFormat("en-US");

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "used", label: "Written" },
  { key: "ignored", label: "Ignored" },
];

const primaryButtonClassName =
  "inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClassName =
  "inline-flex h-11 items-center gap-1.5 rounded border border-border px-4 text-sm text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";
const smallPrimaryButtonClassName =
  "inline-flex h-9 items-center gap-1.5 rounded bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const smallSecondaryButtonClassName =
  "inline-flex h-9 items-center gap-1.5 rounded border border-border px-2.5 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";
const inputClassName =
  "h-11 w-full rounded border border-input bg-surface px-3 text-base text-foreground placeholder:text-ink-faint";

function statusText(status: string): string {
  if (status === "used") return "Written";
  if (status === "ignored") return "Ignored";
  return "New";
}

function competitionTone(
  value: string | null,
): "text-ok" | "text-warn" | "text-danger" | null {
  const normalized = value?.toUpperCase() ?? "";
  if (normalized === "LOW") return "text-ok";
  if (normalized === "MEDIUM") return "text-warn";
  if (normalized === "HIGH") return "text-danger";
  return null;
}

function formatBidRange(low: number | null, high: number | null): string {
  if (low === null || high === null) return "Pricing not listed";
  const format = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
  return `${format(low)} to ${format(high)}`;
}

export default function KeywordsManager({
  initialKeywords,
  plannerConfigured,
}: {
  initialKeywords: KeywordItem[];
  plannerConfigured: boolean;
}) {
  const { toast } = useToast();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [minVolume, setMinVolume] = useState("");
  const [maxCompetitionIndex, setMaxCompetitionIndex] = useState("");
  const [competitionFilter, setCompetitionFilter] =
    useState<CompetitionFilter>("all");
  const [sort, setSort] = useState<SortKey>("avgMonthlySearches");
  const [dir, setDir] = useState<SortDirection>("desc");

  const [showSync, setShowSync] = useState(false);
  const [seeds, setSeeds] = useState("");
  const [useSiteUrl, setUseSiteUrl] = useState(true);
  const [syncMinVolume, setSyncMinVolume] = useState("");

  const [newKeyword, setNewKeyword] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<{
    keywordId: string;
    postId: string;
  } | null>(null);

  const [isSyncing, startSync] = useTransition();
  const [isAdding, startAdd] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isGenerating, startGenerate] = useTransition();
  const [isUpdatingStatus, startStatusUpdate] = useTransition();
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = minVolume.trim() === "" ? null : Number(minVolume);
    const maxIndex =
      maxCompetitionIndex.trim() === "" ? null : Number(maxCompetitionIndex);

    return initialKeywords.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (
        competitionFilter !== "all" &&
        (row.competition?.toUpperCase() ?? "") !== competitionFilter
      ) {
        return false;
      }
      if (
        min !== null &&
        Number.isFinite(min) &&
        (row.avgMonthlySearches ?? 0) < min
      ) {
        return false;
      }
      if (
        maxIndex !== null &&
        Number.isFinite(maxIndex) &&
        (row.competitionIndex ?? 0) > maxIndex
      ) {
        return false;
      }
      if (q.length > 0 && !row.keyword.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    initialKeywords,
    query,
    statusFilter,
    competitionFilter,
    minVolume,
    maxCompetitionIndex,
  ]);

  const rows = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sort === "keyword") {
        const cmp = a.keyword.localeCompare(b.keyword);
        return dir === "asc" ? cmp : -cmp;
      }
      const cmp = (a[sort] ?? -1) - (b[sort] ?? -1);
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sort, dir]);

  const handleSort = (key: SortKey) => {
    if (sort === key) {
      setDir(dir === "asc" ? "desc" : "asc");
      return;
    }
    setSort(key);
    setDir(key === "keyword" ? "asc" : "desc");
  };

  const handleSync = () => {
    startSync(async () => {
      const rawMinVolume = syncMinVolume.trim();
      const parsedMinVolume = rawMinVolume === "" ? undefined : Number(rawMinVolume);
      const result = await syncKeywordIdeas({
        seeds: seeds.trim() === "" ? undefined : seeds,
        siteUrl: useSiteUrl ? SITE_URL : undefined,
        minVolume:
          parsedMinVolume !== undefined && Number.isFinite(parsedMinVolume)
            ? parsedMinVolume
            : undefined,
      });

      if (result.ok) {
        toast({
          variant: result.incomplete ? "info" : "success",
          label: "Sync complete",
          title: result.incomplete
            ? `Added ${result.added ?? 0}, updated ${result.updated ?? 0}. Time budget reached; run sync again to finish the rest.`
            : `Added ${result.added ?? 0}, updated ${result.updated ?? 0}`,
        });
        router.refresh();
        return;
      }

      toast({
        variant: "error",
        label: "Sync failed",
        title: result.error ?? "Could not sync keyword ideas.",
        detail: result.hint ?? undefined,
      });
    });
  };

  const handleAdd = () => {
    const value = newKeyword.trim();
    if (value.length === 0) return;

    startAdd(async () => {
      const result = await addKeyword(value);
      if (result.ok) {
        toast({
          variant: "success",
          label: "Keyword added",
          title: `"${result.keyword ?? value}" is in the list.`,
        });
        setNewKeyword("");
        router.refresh();
        return;
      }
      toast({
        variant: "error",
        label: "Add failed",
        title: result.error ?? "Could not add the keyword.",
      });
    });
  };

  const handleRefreshMetrics = () => {
    if (filtered.length === 0) return;
    const ids = filtered.map((row) => row.id);

    startRefresh(async () => {
      const result = await refreshKeywordMetrics(ids);
      if (result.ok) {
        const updated = result.updated ?? 0;
        toast({
          variant: result.incomplete ? "info" : "success",
          label: "Metrics refreshed",
          title: result.incomplete
            ? `Updated ${updated} keyword${updated === 1 ? "" : "s"}. Time budget reached; run refresh again to finish.`
            : `Updated ${updated} keyword${updated === 1 ? "" : "s"}.`,
        });
        router.refresh();
        return;
      }
      toast({
        variant: "error",
        label: "Refresh failed",
        title: result.error ?? "Could not refresh keyword metrics.",
        detail: result.hint ?? undefined,
      });
    });
  };

  const handleStatusChange = (id: string, status: "new" | "ignored") => {
    setStatusPendingId(id);
    startStatusUpdate(async () => {
      try {
        const result = await setKeywordStatus(id, status);
        if (result.ok) {
          toast({
            variant: "success",
            label: status === "ignored" ? "Keyword ignored" : "Keyword restored",
            title:
              status === "ignored"
                ? "Its metrics stay, but the New view skips it."
                : "The keyword is back in the New view.",
          });
          router.refresh();
          return;
        }
        toast({
          variant: "error",
          label: "Status change failed",
          title: result.error ?? "Could not change the keyword status.",
        });
      } finally {
        setStatusPendingId(null);
      }
    });
  };

  const handleGenerateDraft = (id: string) => {
    if (generatingId !== null) {
      toast({
        variant: "info",
        label: "Generation running",
        title: "A draft is already being generated. Wait for it to finish.",
      });
      return;
    }

    setGeneratingId(id);
    startGenerate(async () => {
      try {
        const result = await generateDraftFromKeyword(id);
        if (result.ok && result.postId) {
          setConfirmId(null);
          setDraftNotice({ keywordId: id, postId: result.postId });
          toast({
            variant: "success",
            label: "Draft ready",
            title: result.detail ?? "Draft created.",
          });
          router.refresh();
          return;
        }
        if (result.status === "skipped") {
          toast({
            variant: "info",
            label: "Generation running",
            title:
              result.error ?? "Another generation is already running.",
          });
          return;
        }
        toast({
          variant: "error",
          label: "Generation failed",
          title:
            result.error ?? "The draft was created but the post link is missing.",
          detail: result.detail ?? undefined,
        });
      } finally {
        setGeneratingId(null);
      }
    });
  };

  const handleCopy = async (keyword: string) => {
    try {
      await navigator.clipboard.writeText(keyword);
      toast({
        variant: "info",
        label: "Keyword copied",
        title: keyword,
      });
    } catch {
      toast({
        variant: "error",
        label: "Copy failed",
        title: "Clipboard access is not available in this browser.",
      });
    }
  };

  const sortableHeader = (label: string, key: SortKey) => {
    const active = sort === key;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (dir === "asc" ? "ascending" : "descending") : "none"
        }
        className="px-4 py-3 font-normal"
      >
        <button
          type="button"
          onClick={() => handleSort(key)}
          className={cn(
            "inline-flex items-center gap-1 transition-colors hover:text-foreground",
            active && "text-foreground",
          )}
        >
          <span>{label}</span>
          {active ? (
            dir === "asc" ? (
              <ArrowUp size={10} aria-hidden="true" />
            ) : (
              <ArrowDown size={10} aria-hidden="true" />
            )
          ) : null}
        </button>
      </th>
    );
  };

  return (
    <div className="border-t border-border">
      <div className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-5">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={statusFilter === filter.key}
                className={cn(
                  "text-sm transition-colors",
                  statusFilter === filter.key
                    ? "text-foreground underline decoration-1 underline-offset-4"
                    : "text-ink-muted hover:text-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <label htmlFor="keywords-search" className="sr-only">
              Search keywords
            </label>
            <input
              id="keywords-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search keywords"
              className="h-11 w-full rounded border border-input bg-surface pl-9 pr-3 text-base text-ink placeholder:text-ink-faint"
            />
            <MagnifyingGlass
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block w-40">
            <span className="eyebrow block text-ink-faint">Min monthly volume</span>
            <input
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              value={minVolume}
              onChange={(event) => setMinVolume(event.target.value)}
              placeholder="Any"
              className={cn(inputClassName, "mt-1.5 font-mono text-sm")}
            />
          </label>

          <label className="block w-44">
            <span className="eyebrow block text-ink-faint">
              Max competition index
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={maxCompetitionIndex}
              onChange={(event) => setMaxCompetitionIndex(event.target.value)}
              placeholder="0 to 100"
              className={cn(inputClassName, "mt-1.5 font-mono text-sm")}
            />
          </label>

          <label className="block w-40">
            <span className="eyebrow block text-ink-faint">Competition</span>
            <select
              value={competitionFilter}
              onChange={(event) =>
                setCompetitionFilter(event.target.value as CompetitionFilter)
              }
              className={cn(inputClassName, "mt-1.5")}
            >
              <option value="all">All</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSync((current) => !current)}
              aria-expanded={showSync}
              className={cn(
                secondaryButtonClassName,
                showSync && "border-border bg-accent text-foreground",
              )}
            >
              <ArrowsClockwise size={14} aria-hidden="true" />
              <span>Sync ideas</span>
            </button>

            <button
              type="button"
              onClick={handleRefreshMetrics}
              disabled={
                !plannerConfigured || isRefreshing || filtered.length === 0
              }
              title={
                plannerConfigured
                  ? `Refresh metrics for the ${filtered.length} filtered keyword${
                      filtered.length === 1 ? "" : "s"
                    }`
                  : "Keyword Planner is not configured. Add the developer token and customer ID in Settings."
              }
              className={secondaryButtonClassName}
            >
              {isRefreshing ? (
                <CircleNotch
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ArrowsClockwise size={14} aria-hidden="true" />
              )}
              <span>{isRefreshing ? "Refreshing..." : "Refresh metrics"}</span>
              {isRefreshing ? null : (
                <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                  {filtered.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {showSync ? (
          <div className="rounded border border-border bg-surface p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="eyebrow text-ink-faint">Seed keywords</span>
                <textarea
                  value={seeds}
                  onChange={(event) => setSeeds(event.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder="Leave empty for the category bank + Search Console seeds"
                  className="mt-2 w-full rounded border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-ink-faint"
                />
              </label>

              <div className="space-y-4">
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={useSiteUrl}
                    onChange={(event) => setUseSiteUrl(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[var(--clay)]"
                  />
                  <span>
                    <span className="block text-sm text-foreground">
                      Use site URL seed
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-faint">
                      {SITE_URL}
                    </span>
                  </span>
                </label>

                <label className="block">
                  <span className="eyebrow text-ink-faint">
                    Minimum monthly volume
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    inputMode="numeric"
                    value={syncMinVolume}
                    onChange={(event) => setSyncMinVolume(event.target.value)}
                    placeholder="Any volume"
                    className={cn(inputClassName, "mt-2 font-mono text-sm")}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-start justify-between gap-3 md:flex-col md:items-end">
                <p className="max-w-prose text-[13px] text-ink-muted">
                  Runs up to three Google Ads calls: the site URL seed plus the
                  seed list, then skips duplicates and banned topics.
                </p>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={!plannerConfigured || isSyncing}
                  title={
                    plannerConfigured
                      ? undefined
                      : "Keyword Planner is not configured. Add the developer token and customer ID in Settings."
                  }
                  className={primaryButtonClassName}
                >
                  {isSyncing ? (
                    <CircleNotch
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowsClockwise size={14} aria-hidden="true" />
                  )}
                  <span>{isSyncing ? "Syncing..." : "Run sync"}</span>
                </button>
              </div>
            </div>

            {!plannerConfigured ? (
              <p className="mt-3 border-t border-border pt-3 text-[13px] text-ink-muted">
                Keyword Planner is not configured. Add the developer token and
                customer ID in{" "}
                <Link
                  href="/admin/settings"
                  className="underline decoration-1 underline-offset-4 transition-colors hover:text-foreground"
                >
                  Settings
                </Link>
                .
              </p>
            ) : null}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleAdd();
          }}
          className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
        >
          <label className="block flex-1">
            <span className="eyebrow block text-ink-faint">Add keyword</span>
            <input
              type="text"
              value={newKeyword}
              onChange={(event) => setNewKeyword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="A keyword to track manually"
              className={cn(inputClassName, "mt-1.5")}
            />
          </label>
          <button
            type="submit"
            disabled={isAdding || newKeyword.trim().length === 0}
            className={primaryButtonClassName}
          >
            {isAdding ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
            <span>{isAdding ? "Adding..." : "Add keyword"}</span>
          </button>
        </form>
      </div>

      <div className="overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[13px] text-ink-muted">
              {sortableHeader("Keyword", "keyword")}
              {sortableHeader("Monthly searches", "avgMonthlySearches")}
              <th scope="col" className="px-4 py-3 font-normal">
                Competition
              </th>
              {sortableHeader("Comp. index", "competitionIndex")}
              <th scope="col" className="px-4 py-3 font-normal">
                Bid range
              </th>
              <th scope="col" className="px-4 py-3 font-normal">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-normal">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center">
                  {initialKeywords.length === 0 ? (
                    <>
                      <p className="font-medium text-foreground">
                        No keywords yet.
                      </p>
                      <p className="mx-auto mt-1 max-w-prose text-sm text-ink-muted">
                        {plannerConfigured ? (
                          <>
                            Use{" "}
                            <button
                              type="button"
                              onClick={() => setShowSync(true)}
                              className="underline decoration-1 underline-offset-4 transition-colors hover:text-foreground"
                            >
                              Sync ideas
                            </button>{" "}
                            to pull suggestions from Google Ads and Search
                            Console, or add one manually in the Add keyword
                            field above.
                          </>
                        ) : (
                          "Add a keyword manually in the field above. Sync ideas needs the Keyword Planner configuration."
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="font-medium text-foreground">
                      No keywords match these filters.
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const expanded = expandedId === row.id;
                const confirming = confirmId === row.id;
                const canGenerate =
                  row.status === "new" || row.status === "ignored";
                const volumes = row.monthlyVolumes ?? [];
                const notice =
                  draftNotice && draftNotice.keywordId === row.id
                    ? draftNotice
                    : null;

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={cn(
                        "transition-colors hover:bg-accent/40",
                        expanded && "bg-accent/30",
                      )}
                    >
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedId(expanded ? null : row.id);
                            if (generatingId !== row.id) {
                              setConfirmId(null);
                            }
                          }}
                          aria-expanded={expanded}
                          aria-controls={`keyword-detail-${row.id}`}
                          className="group flex items-start gap-2 text-left"
                        >
                          <CaretRight
                            size={12}
                            aria-hidden="true"
                            className={cn(
                              "mt-1 shrink-0 text-ink-faint transition-transform",
                              expanded && "rotate-90",
                            )}
                          />
                          <span className="text-sm font-medium text-foreground underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-border">
                            {row.keyword}
                          </span>
                        </button>
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 font-mono text-[13px] tabular-nums text-ink-muted">
                        {row.avgMonthlySearches === null ? (
                          <span className="text-ink-faint">Not reported</span>
                        ) : (
                          numberFormat.format(row.avgMonthlySearches)
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-4">
                        <span
                          className={cn(
                            "inline-flex rounded border border-border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em]",
                            competitionTone(row.competition) ??
                              "text-ink-faint",
                          )}
                        >
                          {(row.competition ?? "Unknown").toUpperCase()}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 font-mono text-[13px] tabular-nums text-ink-muted">
                        {row.competitionIndex === null ? (
                          <span className="text-ink-faint">Not reported</span>
                        ) : (
                          row.competitionIndex
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 font-mono text-[13px] tabular-nums text-ink-muted">
                        {row.lowTopOfPageBidMicros === null ||
                        row.highTopOfPageBidMicros === null ? (
                          <span className="text-ink-faint">
                            Pricing not listed
                          </span>
                        ) : (
                          formatBidRange(
                            row.lowTopOfPageBidMicros,
                            row.highTopOfPageBidMicros,
                          )
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 text-[13px]">
                        {row.status === "used" && row.postId ? (
                          <Link
                            href={`/admin/edit/${row.postId}`}
                            className="text-foreground underline decoration-1 underline-offset-4 transition-colors hover:text-ink-muted"
                          >
                            Written
                          </Link>
                        ) : (
                          <span className="text-ink-faint">
                            {statusText(row.status)}
                          </span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 font-mono text-[13px] tabular-nums text-ink-muted">
                        {row.updatedAt.slice(0, 10)}
                      </td>
                    </tr>

                    {expanded ? (
                      <tr id={`keyword-detail-${row.id}`} className="bg-paper-soft">
                        <td colSpan={7} className="px-4 py-5">
                          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                            <div className="min-w-0">
                              {volumes.length > 0 ? (
                                <>
                                  <p className="eyebrow text-ink-faint">
                                    Monthly volumes
                                  </p>
                                  <div className="mt-2 max-w-2xl">
                                    <LineChart
                                      compact
                                      points={volumes.map((volume) => ({
                                        label: `${volume.month.toUpperCase()} ${volume.year}`,
                                        a: volume.monthlySearches,
                                        b: 0,
                                      }))}
                                      labels={["Monthly searches", "Unused"]}
                                    />
                                  </div>
                                </>
                              ) : (
                                <p className="text-[13px] text-ink-muted">
                                  No monthly volume history was returned for
                                  this keyword.
                                </p>
                              )}

                              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                                <span>source {row.source}</span>
                                <span>
                                  {row.fetchedAt
                                    ? `fetched ${row.fetchedAt.slice(0, 10)}`
                                    : "never fetched"}
                                </span>
                                {row.usedAt ? (
                                  <span>used {row.usedAt.slice(0, 10)}</span>
                                ) : null}
                              </p>
                            </div>

                            <div>
                              <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
                                {generatingId === row.id ? (
                                  <p
                                    aria-live="polite"
                                    className="inline-flex h-9 items-center gap-1.5 rounded border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted"
                                  >
                                    <CircleNotch
                                      size={14}
                                      className="animate-spin"
                                      aria-hidden="true"
                                    />
                                    <span>Drafting</span>
                                  </p>
                                ) : null}
                                {canGenerate && !confirming ? (
                                  generatingId === row.id ? (
                                    <p
                                      aria-live="polite"
                                      className="inline-flex h-9 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted"
                                    >
                                      <CircleNotch
                                        size={14}
                                        className="animate-spin"
                                        aria-hidden="true"
                                      />
                                      <span>Drafting in progress</span>
                                    </p>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmId(row.id)}
                                      disabled={generatingId !== null}
                                      title={
                                        generatingId !== null
                                          ? "A draft is already being generated"
                                          : undefined
                                      }
                                      className={smallPrimaryButtonClassName}
                                    >
                                      <Sparkle size={14} aria-hidden="true" />
                                      <span>Generate draft</span>
                                    </button>
                                  )
                                ) : null}

                                {row.status === "ignored" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStatusChange(row.id, "new")
                                    }
                                    disabled={isUpdatingStatus}
                                    className={smallSecondaryButtonClassName}
                                  >
                                    {statusPendingId === row.id ? (
                                      <CircleNotch
                                        size={14}
                                        className="animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : null}
                                    <span>Mark new</span>
                                  </button>
                                ) : row.status === "new" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStatusChange(row.id, "ignored")
                                    }
                                    disabled={isUpdatingStatus}
                                    className={smallSecondaryButtonClassName}
                                  >
                                    {statusPendingId === row.id ? (
                                      <CircleNotch
                                        size={14}
                                        className="animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : null}
                                    <span>Mark ignored</span>
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleCopy(row.keyword);
                                  }}
                                  className={smallSecondaryButtonClassName}
                                >
                                  <CopySimple size={14} aria-hidden="true" />
                                  <span>Copy keyword</span>
                                </button>
                              </div>

                              {confirming ? (
                                generatingId === row.id ? (
                                  <div className="mt-4 rounded border border-border bg-surface p-4">
                                    <p
                                      aria-live="polite"
                                      className="flex items-center gap-2 text-sm text-foreground"
                                    >
                                      <CircleNotch
                                        size={14}
                                        className="animate-spin"
                                        aria-hidden="true"
                                      />
                                      <span>
                                        Drafting in progress. Collapsing this
                                        section keeps the request running.
                                      </span>
                                    </p>
                                  </div>
                                ) : (
                                  <div className="mt-4 rounded border border-border bg-surface p-4">
                                    <p className="text-sm font-medium text-foreground">
                                      Generate a draft for this keyword?
                                    </p>
                                    <p className="mt-1 text-[13px] text-ink-muted">
                                      Generation can take a few minutes.
                                    </p>
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setConfirmId(null)}
                                        disabled={isGenerating}
                                        className={smallSecondaryButtonClassName}
                                      >
                                        <span>Cancel</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleGenerateDraft(row.id)
                                        }
                                        disabled={isGenerating}
                                        className={smallPrimaryButtonClassName}
                                      >
                                        {isGenerating ? (
                                          <CircleNotch
                                            size={14}
                                            className="animate-spin"
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <Sparkle
                                            size={14}
                                            aria-hidden="true"
                                          />
                                        )}
                                        <span>
                                          {isGenerating
                                            ? "Generating..."
                                            : "Generate"}
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                )
                              ) : null}
                            </div>
                          </div>

                          {notice ? (
                            <div
                              role="status"
                              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-4 py-3"
                            >
                              <p className="text-sm text-foreground">
                                Draft created.{" "}
                                <Link
                                  href={`/admin/edit/${notice.postId}`}
                                  className="font-medium underline decoration-1 underline-offset-4"
                                >
                                  Open the draft
                                </Link>
                              </p>
                              <button
                                type="button"
                                onClick={() => setDraftNotice(null)}
                                aria-label="Dismiss draft notice"
                                className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-faint transition-colors hover:text-foreground"
                              >
                                <X size={13} aria-hidden="true" />
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
