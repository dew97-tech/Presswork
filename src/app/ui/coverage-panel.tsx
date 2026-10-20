"use client";

import {
  importCoverageExports,
  inspectCoverageUrls,
  setCoverageIssueResolution,
} from "@/app/lib/google/coverage-actions";
import {
  COVERAGE_RESOLUTIONS,
  type CoverageIssue,
  type CoverageResolution,
  type CoverageSnapshot,
  type CoverageUrlCheck,
} from "@/app/lib/google/coverage";
import { extractBlogSlug } from "@/app/lib/google/feedback";
import { useToast } from "@/components/ui/toast";
import {
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  MagnifyingGlass,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

interface PublishedPost {
  id: string;
  slug: string;
  title: string;
}

const RESOLUTION_LABELS: Record<CoverageResolution, string> = {
  open: "Open",
  intentional: "Intentional",
  fixing: "Fixing",
  resolved: "Resolved",
};

const RESOLUTION_CLASSES: Record<CoverageResolution, string> = {
  open: "text-ink-muted",
  intentional: "text-ink-faint",
  fixing: "text-warn",
  resolved: "text-ok",
};

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function issueSummary(issues: CoverageIssue[]) {
  return {
    pages: issues.reduce((total, issue) => total + issue.pages, 0),
    open: issues.filter(
      (issue) => issue.resolution === "open" || issue.resolution === "fixing",
    ).length,
    intentional: issues.filter((issue) => issue.resolution === "intentional")
      .length,
    resolved: issues.filter((issue) => issue.resolution === "resolved").length,
  };
}

function issueHint(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes("noindex")) {
    return "Thin tag pages with fewer than 3 posts are intentionally noindexed. Inspect a URL if you expect that page to rank.";
  }
  if (normalized.includes("redirect")) {
    return "Expected for legacy hosts or old slugs. Inspect each URL and confirm the redirect target is the canonical article.";
  }
  if (normalized.includes("not found") || normalized.includes("404")) {
    return "Add a permanent redirect to the closest article, or restore the missing page.";
  }
  if (normalized.includes("canonical")) {
    return "Usually expected for paginated, filtered, or duplicate URLs. Mark intentional after checking the canonical target.";
  }
  if (normalized.includes("discovered")) {
    return "Google knows the URL but has not crawled it yet. Usually no action is needed.";
  }
  return "Inspect the affected URLs before deciding whether this is intentional or needs a fix.";
}

function coverageTone(check: CoverageUrlCheck): string {
  if (check.error) return "text-danger";
  const state = `${check.coverageState ?? ""} ${check.verdict ?? ""}`.toLowerCase();
  if (state.includes("indexed") && !state.includes("not indexed")) {
    return "text-ok";
  }
  if (
    state.includes("not indexed") ||
    state.includes("excluded") ||
    state.includes("noindex") ||
    state.includes("redirect") ||
    state.includes("not found")
  ) {
    return "text-warn";
  }
  return "text-ink-muted";
}

export default function CoveragePanel({
  snapshot,
  publishedPosts,
  property,
}: {
  snapshot: CoverageSnapshot | null;
  publishedPosts: PublishedPost[];
  property: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [criticalCsv, setCriticalCsv] = useState("");
  const [nonCriticalCsv, setNonCriticalCsv] = useState("");
  const [criticalName, setCriticalName] = useState("");
  const [nonCriticalName, setNonCriticalName] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [issueReason, setIssueReason] = useState("");
  const [resolutions, setResolutions] = useState<
    Record<string, CoverageResolution>
  >({});
  const [isImporting, startImport] = useTransition();
  const [isInspecting, startInspect] = useTransition();
  const [isSavingResolution, startSaveResolution] = useTransition();
  const criticalInput = useRef<HTMLInputElement>(null);
  const nonCriticalInput = useRef<HTMLInputElement>(null);

  const issues = snapshot?.issues ?? [];
  const urls = snapshot?.urls ?? [];
  const summary = issueSummary(issues);
  const postsBySlug = new Map(
    publishedPosts.map((post) => [post.slug, post] as const),
  );
  const recentUrls = [...urls]
    .sort(
      (a, b) =>
        new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime(),
    )
    .slice(0, 30);

  const handleFile = async (
    file: File | undefined,
    setCsv: (value: string) => void,
    setName: (value: string) => void,
  ) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({
        variant: "error",
        label: "Unsupported file",
        title: "Choose the CSV files from the Search Console coverage export.",
      });
      return;
    }

    setCsv(await file.text());
    setName(file.name);
  };

  const handleImport = () => {
    startImport(async () => {
      const result = await importCoverageExports({
        criticalCsv,
        nonCriticalCsv,
      });

      if (!result.ok) {
        toast({
          variant: "error",
          label: "Coverage import failed",
          title: result.error,
        });
        return;
      }

      toast({
        variant: "success",
        label: "Coverage imported",
        title: `${result.issues} issues covering ${result.pages} pages.`,
      });

      setCriticalCsv("");
      setNonCriticalCsv("");
      setCriticalName("");
      setNonCriticalName("");
      if (criticalInput.current) criticalInput.current.value = "";
      if (nonCriticalInput.current) nonCriticalInput.current.value = "";
      router.refresh();
    });
  };

  const handleResolution = (
    issue: CoverageIssue,
    resolution: CoverageResolution,
  ) => {
    setResolutions((prev) => ({ ...prev, [issue.reason]: resolution }));

    startSaveResolution(async () => {
      const result = await setCoverageIssueResolution({
        reason: issue.reason,
        resolution,
      });

      if (!result.ok) {
        setResolutions((prev) => ({
          ...prev,
          [issue.reason]: issue.resolution,
        }));
        toast({
          variant: "error",
          label: "Status update failed",
          title: result.error,
        });
        return;
      }

      router.refresh();
    });
  };

  const handleInspect = () => {
    const inputUrls = urlsText
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    startInspect(async () => {
      const result = await inspectCoverageUrls({
        urls: inputUrls,
        issueReason: issueReason || undefined,
      });

      if (!result.ok) {
        toast({
          variant: "error",
          label: "URL inspection failed",
          title: result.error,
        });
        return;
      }

      toast({
        variant: result.errors.length > 0 ? "info" : "success",
        label: "URL inspection complete",
        title: `${result.checked} URLs checked.${result.errors.length > 0 ? ` ${result.errors.length} failed.` : ""}`,
        detail: result.errors.slice(0, 5).join("\n") || undefined,
      });

      setUrlsText("");
      router.refresh();
    });
  };

  const canImport = Boolean(criticalCsv.trim() || nonCriticalCsv.trim());
  const canInspect = urlsText.trim().length > 0;

  return (
    <section className="space-y-6 rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Indexing feedback
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Import the official Search Console coverage export, classify each
            issue, and inspect the affected URLs before fixing them.
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {snapshot?.importedAt
              ? `imported ${formatTimestamp(snapshot.importedAt)}`
              : "no coverage export imported"}
            {snapshot?.lastInspectedAt
              ? ` · last inspected ${formatTimestamp(snapshot.lastInspectedAt)}`
              : ""}
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-border bg-surface px-4 py-3">
          <p className="eyebrow text-ink-faint">Affected pages</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-foreground">
            {summary.pages}
          </p>
        </div>
        <div className="rounded border border-border bg-surface px-4 py-3">
          <p className="eyebrow text-ink-faint">Open / fixing</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-warn">
            {summary.open}
          </p>
        </div>
        <div className="rounded border border-border bg-surface px-4 py-3">
          <p className="eyebrow text-ink-faint">Intentional</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-ink-muted">
            {summary.intentional}
          </p>
        </div>
        <div className="rounded border border-border bg-surface px-4 py-3">
          <p className="eyebrow text-ink-faint">Resolved</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-ok">
            {summary.resolved}
          </p>
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Import coverage export
          </h3>
          <p className="mt-1 text-[13px] text-ink-muted">
            Extract the Search Console coverage ZIP and import both CSV files.
            Existing statuses are preserved when you re-import.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block rounded border border-border bg-surface p-4 text-[13px] text-ink-muted">
            <span className="eyebrow block text-ink-faint">
              Critical issues.csv
            </span>
            <input
              ref={criticalInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                void handleFile(
                  event.target.files?.[0],
                  setCriticalCsv,
                  setCriticalName,
                )
              }
              className="mt-2 block w-full text-[13px] text-ink-muted file:mr-3 file:rounded file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[13px] file:text-foreground"
            />
            <span className="mt-2 block font-mono text-[11px] text-ink-faint">
              {criticalName || "Critical issues export"}
            </span>
          </label>

          <label className="block rounded border border-border bg-surface p-4 text-[13px] text-ink-muted">
            <span className="eyebrow block text-ink-faint">
              Non-critical issues.csv
            </span>
            <input
              ref={nonCriticalInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                void handleFile(
                  event.target.files?.[0],
                  setNonCriticalCsv,
                  setNonCriticalName,
                )
              }
              className="mt-2 block w-full text-[13px] text-ink-muted file:mr-3 file:rounded file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[13px] file:text-foreground"
            />
            <span className="mt-2 block font-mono text-[11px] text-ink-faint">
              {nonCriticalName || "Non-critical issues export"}
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={handleImport}
          disabled={isImporting || !canImport}
          className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isImporting ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <UploadSimple size={14} aria-hidden="true" />
          )}
          <span>{isImporting ? "Importing..." : "Import coverage"}</span>
        </button>
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">Issues</h3>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {issues.length} categories
          </span>
        </div>

        {issues.length === 0 ? (
          <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
            Import the coverage export to see the issues reported by Google.
          </p>
        ) : (
          <ul className="space-y-2">
            {issues.map((issue) => {
              const resolution = resolutions[issue.reason] ?? issue.resolution;
              return (
                <li
                  key={issue.reason}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{issue.reason}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                      {issueHint(issue.reason)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint">
                      <span>{issue.pages} pages</span>
                      {issue.source ? <span>{issue.source}</span> : null}
                      {issue.validation ? (
                        <span>validation {issue.validation}</span>
                      ) : null}
                      <span className={RESOLUTION_CLASSES[resolution]}>
                        {RESOLUTION_LABELS[resolution]}
                      </span>
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <span className="sr-only">Resolution</span>
                    <select
                      value={resolution}
                      disabled={isSavingResolution}
                      onChange={(event) =>
                        handleResolution(
                          issue,
                          event.target.value as CoverageResolution,
                        )
                      }
                      className="h-9 rounded border border-input bg-surface px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-foreground disabled:opacity-60"
                    >
                      {COVERAGE_RESOLUTIONS.map((value) => (
                        <option key={value} value={value}>
                          {RESOLUTION_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Inspect affected URLs
          </h3>
          <p className="mt-1 max-w-prose text-[13px] text-ink-muted">
            The coverage CSV contains counts, not the affected URLs. Copy the
            URLs from a GSC issue detail view, paste up to 20 below, and inspect
            them against the live property. This confirms whether the page is
            actually noindexed, redirected, missing, or canonicalized.
          </p>
          <a
            href={`https://search.google.com/search-console/index?resource_id=${encodeURIComponent(property)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[13px] text-ink-muted underline decoration-1 underline-offset-4 transition-colors hover:text-foreground"
          >
            Open the GSC coverage report
            <ArrowSquareOut size={12} aria-hidden="true" />
          </a>
        </div>

        <textarea
          value={urlsText}
          onChange={(event) => setUrlsText(event.target.value)}
          rows={4}
          placeholder={"https://davidmallick.dev/blog/old-post\nhttps://davidmallick.dev/blog/tag/example"}
          className="block w-full rounded border border-input bg-surface px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-faint"
        />

        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-[13px] text-ink-muted">
            <span className="eyebrow block text-ink-faint">Attach to issue</span>
            <select
              value={issueReason}
              onChange={(event) => setIssueReason(event.target.value)}
              className="mt-1 h-10 min-w-56 rounded border border-input bg-surface px-2 text-[13px] text-foreground"
            >
              <option value="">General / not specified</option>
              {issues.map((issue) => (
                <option key={issue.reason} value={issue.reason}>
                  {issue.reason}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={handleInspect}
            disabled={isInspecting || !canInspect}
            className="inline-flex h-10 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isInspecting ? (
              <CircleNotch
                size={14}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <MagnifyingGlass size={14} aria-hidden="true" />
            )}
            <span>{isInspecting ? "Inspecting..." : "Inspect URLs"}</span>
          </button>

          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {recentUrls.length} checked
          </span>
        </div>

        {recentUrls.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border">
            {recentUrls.map((check) => {
              const slug = extractBlogSlug(check.url);
              const post = slug ? postsBySlug.get(slug) : null;
              const canonicalMismatch =
                check.googleCanonical &&
                check.userCanonical &&
                check.googleCanonical !== check.userCanonical;

              return (
                <li key={check.url} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a
                        href={check.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 break-all font-mono text-[12px] text-foreground underline decoration-transparent underline-offset-4 transition-colors hover:decoration-border"
                      >
                        {check.url}
                        <ArrowSquareOut
                          size={11}
                          aria-hidden="true"
                          className="shrink-0 text-ink-faint"
                        />
                      </a>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint">
                        {check.error ? (
                          <span className="text-danger">{check.error}</span>
                        ) : (
                          <span className={coverageTone(check)}>
                            {check.coverageState ??
                              check.verdict ??
                              "unknown state"}
                          </span>
                        )}
                        {check.lastCrawlTime ? (
                          <span>
                            crawled{" "}
                            {formatTimestamp(check.lastCrawlTime) ??
                              check.lastCrawlTime}
                          </span>
                        ) : null}
                        {check.issueReason ? (
                          <span>{check.issueReason}</span>
                        ) : null}
                        {canonicalMismatch ? (
                          <span className="text-warn">
                            canonical differs from Google
                          </span>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {post ? (
                        <>
                          <span className="text-[13px] text-ink-muted">
                            {post.title}
                          </span>
                          <Link
                            href={`/admin/edit/${post.id}?tab=review`}
                            className="inline-flex h-8 items-center rounded border border-border px-2.5 text-[13px] text-ink-muted transition-colors hover:text-foreground"
                          >
                            Review
                          </Link>
                          <Link
                            href={`/admin/edit/${post.id}`}
                            className="inline-flex h-8 items-center rounded border border-border px-2.5 text-[13px] text-ink-muted transition-colors hover:text-foreground"
                          >
                            Edit
                          </Link>
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-[13px] text-ink-muted">
                          <WarningCircle size={13} aria-hidden="true" />
                          No matching article
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded border border-dashed border-border px-4 py-5 text-center text-[13px] text-ink-muted">
            No URLs inspected yet. Paste the affected URLs from GSC above.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 rounded border border-border border-l-2 border-l-[var(--clay)] bg-surface p-3 text-[13px] text-ink-muted">
        <CheckCircle
          size={15}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-ok"
        />
        <p>
          After fixing an issue, mark it <span className="text-foreground">Fixing</span>{" "}
          or <span className="text-foreground">Resolved</span>, deploy, then use
          Validate fix in Google Search Console. The API cannot trigger Google&apos;s
          validation step.
        </p>
      </div>
    </section>
  );
}
