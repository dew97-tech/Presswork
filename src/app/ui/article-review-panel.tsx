"use client";

import {
  applyReview,
  discardReview,
  getReview,
  reviewArticle,
} from "@/app/lib/review-actions";
import type {
  ReviewHistoryItem,
  ReviewResult,
} from "@/app/lib/ai/review-article";
import { toPlainText } from "@/app/lib/toc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  CircleNotch,
  Info,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState, useTransition } from "react";

type ApplyField = "title" | "description" | "content";

const SEVERITY_COLORS: Record<string, string> = {
  error: "text-danger",
  warning: "text-warn",
  suggestion: "text-ink-faint",
};

const VERDICT_CLASSES: Record<string, string> = {
  supported: "text-ok border-ok/40",
  contradicted: "text-danger border-danger/40",
  unverifiable: "text-ink-faint border-border",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  applied: "Applied",
  discarded: "Discarded",
  failed: "Failed",
};

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ArticleReviewPanel({
  postId,
  current,
  initialHistory,
  reviewModelLabel,
  webSearchConfigured,
  onHistoryChange,
}: {
  postId: string;
  current: { title: string; description: string };
  initialHistory: ReviewHistoryItem[];
  reviewModelLabel: string;
  webSearchConfigured: boolean;
  onHistoryChange?: (history: ReviewHistoryItem[]) => void;
}) {
  const { toast } = useToast();
  const [active, setActive] = useState<ReviewResult | null>(null);
  const [history, setHistory] = useState<ReviewHistoryItem[]>(initialHistory);
  const [selected, setSelected] = useState<Record<ApplyField, boolean>>({
    title: true,
    description: true,
    content: true,
  });
  const [isReviewing, startReview] = useTransition();
  const [isApplying, startApply] = useTransition();
  const [isLoading, startLoad] = useTransition();

  const suggested = active?.suggested ?? null;
  const hasSuggestions =
    Boolean(suggested?.title) ||
    Boolean(suggested?.description) ||
    Boolean(suggested?.content);

  const updateHistory = (
    updater: (prev: ReviewHistoryItem[]) => ReviewHistoryItem[],
  ) => {
    const next = updater(history);
    setHistory(next);
    onHistoryChange?.(next);
  };

  const handleReview = () => {
    startReview(async () => {
      const result = await reviewArticle(postId);

      if (!result.ok) {
        toast({
          variant: "error",
          label: "Review failed",
          title: result.error,
        });
        return;
      }

      setActive(result.review);
      setSelected({
        title: Boolean(result.review.suggested?.title),
        description: Boolean(result.review.suggested?.description),
        content: Boolean(result.review.suggested?.content),
      });
      updateHistory((prev) =>
        [
          {
            id: result.review.reviewId,
            model: result.review.model,
            status: result.review.status,
            findingCount: result.review.findings.length,
            errorCount: result.review.findings.filter(
              (finding) => finding.severity === "error",
            ).length,
            warningCount: result.review.findings.filter(
              (finding) => finding.severity === "warning",
            ).length,
            createdAt: result.review.createdAt,
          },
          ...prev,
        ].slice(0, 5),
      );

      const errors = result.review.findings.filter(
        (finding) => finding.severity === "error",
      ).length;
      toast({
        variant: errors > 0 ? "error" : "success",
        label: "Review complete",
        title: `${result.review.findings.length} findings, ${errors} errors. ${
          result.review.usedWebSearch
            ? "Web search was used."
            : "No web search available."
        }`,
      });
    });
  };

  const handleApply = () => {
    if (!active) {
      return;
    }

    const fields = (["title", "description", "content"] as ApplyField[]).filter(
      (field) => selected[field] && suggested?.[field],
    );

    if (fields.length === 0) {
      toast({
        variant: "error",
        label: "Nothing selected",
        title: "Select at least one suggested field to apply.",
      });
      return;
    }

    startApply(async () => {
      const result = await applyReview(active.reviewId, fields);

      if (!result.ok) {
        toast({
          variant: "error",
          label: "Apply failed",
          title: result.error,
        });
        return;
      }

      updateHistory((prev) =>
        prev.map((item) =>
          item.id === active.reviewId ? { ...item, status: "applied" } : item,
        ),
      );
      setActive({ ...active, status: "applied" });
      toast({
        variant: "success",
        label: "Changes applied",
        title: "The article is being reloaded to show the applied changes.",
      });
      setTimeout(() => window.location.reload(), 700);
    });
  };

  const handleDiscard = () => {
    if (!active) {
      return;
    }

    startApply(async () => {
      await discardReview(active.reviewId);
      updateHistory((prev) =>
        prev.map((item) =>
          item.id === active.reviewId ? { ...item, status: "discarded" } : item,
        ),
      );
      setActive(null);
      toast({ variant: "info", label: "Review discarded", title: "The article was not changed." });
    });
  };

  const handleView = (reviewId: string) => {
    startLoad(async () => {
      const result = await getReview(reviewId);
      if (!result.ok) {
        toast({ variant: "error", label: "Load failed", title: result.error });
        return;
      }
      if (!result.review) {
        toast({ variant: "error", label: "Load failed", title: "Review not found." });
        return;
      }

      setActive(result.review);
      setSelected({
        title: Boolean(result.review.suggested?.title),
        description: Boolean(result.review.suggested?.description),
        content: Boolean(result.review.suggested?.content),
      });
    });
  };

  const secondaryButtonClassName =
    "inline-flex h-11 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <section className="space-y-6 rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            AI review
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Audits accuracy, code, SEO, and structure, and proposes corrections
            you can apply per field.
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
            <span>Reviewed by {reviewModelLabel}</span>
            <span
              className={cn(
                "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                webSearchConfigured
                  ? "border-ok/40 text-ok"
                  : "border-warn/40 text-warn",
              )}
            >
              {webSearchConfigured
                ? "Web search on"
                : "No web search, claims are unverified"}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={handleReview}
          disabled={isReviewing || isApplying}
          className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isReviewing ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkle size={14} aria-hidden="true" />
          )}
          <span>{isReviewing ? "Reviewing..." : "Review article"}</span>
        </button>
      </header>

      {isReviewing ? (
        <p className="text-[13px] text-ink-muted">
          The reviewer reads the article and checks its claims. This can take up
          to a minute.
        </p>
      ) : null}

      {active ? (
        <div className="space-y-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            <span>{active.model}</span>
            <span>{STATUS_LABELS[active.status] ?? active.status}</span>
            <span>{formatTimestamp(active.createdAt)}</span>
            {typeof active.inputTokens === "number" ? (
              <span>
                {active.inputTokens} in / {active.outputTokens ?? 0} out tokens
              </span>
            ) : null}
            {typeof active.cost === "number" ? (
              <span>${active.cost.toFixed(4)}</span>
            ) : null}
          </div>

          {active.claims.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Claims checked ({active.claims.length})
              </h3>
              <ul className="mt-3 space-y-3">
                {active.claims.map((claim, index) => (
                  <li
                    key={`${index}-${claim.claim.slice(0, 24)}`}
                    className="border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                          VERDICT_CLASSES[claim.verdict],
                        )}
                      >
                        {claim.verdict}
                      </span>
                      <span className="text-[13px] text-foreground">
                        {claim.claim}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {claim.evidence}
                      {claim.sourceTitle ? ` (${claim.sourceTitle})` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {active.findings.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Findings ({active.findings.length})
              </h3>
              <ul className="mt-3 space-y-3">
                {active.findings.map((finding, index) => (
                  <li
                    key={`${index}-${finding.title.slice(0, 24)}`}
                    className={cn(
                      "border-l-2 pl-3",
                      finding.severity === "error"
                        ? "border-l-danger"
                        : finding.severity === "warning"
                          ? "border-l-warn"
                          : "border-l-border",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {finding.severity === "error" ? (
                        <WarningCircle
                          size={14}
                          weight="fill"
                          aria-hidden="true"
                          className="text-danger"
                        />
                      ) : finding.severity === "warning" ? (
                        <WarningCircle
                          size={14}
                          aria-hidden="true"
                          className="text-warn"
                        />
                      ) : (
                        <Info
                          size={14}
                          aria-hidden="true"
                          className="text-ink-faint"
                        />
                      )}
                      <span className="text-[13px] font-medium text-foreground">
                        {finding.title}
                      </span>
                      <span className="blog-tag text-[10px]">
                        {finding.category}
                      </span>
                      {finding.verifiedBy === "code" ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                          code verified
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "font-mono text-[10px] uppercase tracking-[0.08em]",
                          SEVERITY_COLORS[finding.severity],
                        )}
                      >
                        {finding.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {finding.detail}
                    </p>
                    {finding.fix ? (
                      <p className="mt-1 text-[13px] text-foreground">
                        Fix: {finding.fix}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">
              No findings. The reviewer did not flag anything in this article.
            </p>
          )}

          {active.seoNotes ? (
            <div>
              <h3 className="text-sm font-medium text-foreground">SEO notes</h3>
              <ul className="mt-2 space-y-1 text-[13px] text-ink-muted">
                {active.seoNotes.titleSuggestion ? (
                  <li>Title: {active.seoNotes.titleSuggestion}</li>
                ) : null}
                {active.seoNotes.descriptionSuggestion ? (
                  <li>
                    Description: {active.seoNotes.descriptionSuggestion}
                  </li>
                ) : null}
                {active.seoNotes.keywordNotes ? (
                  <li>{active.seoNotes.keywordNotes}</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {hasSuggestions && active.status === "completed" ? (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Suggested changes
              </h3>

              {suggested?.title ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={selected.title}
                      onChange={(event) =>
                        setSelected((prev) => ({
                          ...prev,
                          title: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[var(--clay)]"
                    />
                    <span>Apply title</span>
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded border border-border bg-surface p-3">
                      <p className="eyebrow text-ink-faint">Current</p>
                      <p className="mt-1 text-sm text-foreground">
                        {current.title}
                      </p>
                    </div>
                    <div className="rounded border border-border bg-surface p-3">
                      <p className="eyebrow text-ink-faint">Suggested</p>
                      <p className="mt-1 text-sm text-foreground">
                        {suggested.title}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {suggested?.description ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={selected.description}
                      onChange={(event) =>
                        setSelected((prev) => ({
                          ...prev,
                          description: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[var(--clay)]"
                    />
                    <span>Apply description</span>
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded border border-border bg-surface p-3">
                      <p className="eyebrow text-ink-faint">Current</p>
                      <p className="mt-1 text-sm text-foreground">
                        {current.description}
                      </p>
                    </div>
                    <div className="rounded border border-border bg-surface p-3">
                      <p className="eyebrow text-ink-faint">Suggested</p>
                      <p className="mt-1 text-sm text-foreground">
                        {suggested.description}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {suggested?.content ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={selected.content}
                      onChange={(event) =>
                        setSelected((prev) => ({
                          ...prev,
                          content: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[var(--clay)]"
                    />
                    <span>Apply rewritten article</span>
                  </label>
                  <details className="rounded border border-border bg-surface p-3">
                    <summary className="cursor-pointer text-[13px] text-ink-muted [&::-webkit-details-marker]:hidden">
                      Preview rewritten content
                    </summary>
                    <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[13px] text-ink-muted">
                      {toPlainText(suggested.content)}
                    </p>
                  </details>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={isApplying}
                  className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isApplying ? (
                    <CircleNotch
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle size={14} aria-hidden="true" />
                  )}
                  <span>Apply selected changes</span>
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={isApplying}
                  className={secondaryButtonClassName}
                >
                  Discard review
                </button>
              </div>
            </div>
          ) : null}

          {active.sources.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-foreground">Sources</h3>
              <ul className="mt-2 space-y-1 text-[13px]">
                {active.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink-muted underline decoration-1 underline-offset-4 transition-colors hover:text-foreground"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {history.length > 0 ? (
        <details className="group border-t border-border pt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            History ({history.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0"
              >
                <span className="text-[13px] text-ink-muted">
                  {formatTimestamp(item.createdAt)}
                  <span className="ml-3 font-mono text-[11px] text-ink-faint">
                    {item.model}
                  </span>
                  <span
                    className={cn(
                      "ml-3 font-mono text-[11px] uppercase tracking-[0.08em]",
                      item.status === "applied"
                        ? "text-ok"
                        : item.status === "failed"
                          ? "text-danger"
                          : "text-ink-faint",
                    )}
                  >
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                  <span className="ml-3 font-mono text-[11px] text-ink-faint">
                    {item.findingCount} findings
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleView(item.id)}
                  disabled={isLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
