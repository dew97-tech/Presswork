"use client";

import { analyzeSearchPerformance } from "@/app/lib/google/gsc-actions";
import {
  extractBlogSlug,
  makeFeedbackKey,
  type FeedbackKind,
  type FeedbackReviewMap,
  type FeedbackReviewState,
} from "@/app/lib/google/feedback";
import type { LastAnalysis } from "@/app/lib/settings";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CircleNotch, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const IMPACT_CLASSES: Record<string, string> = {
  high: "border-l-2 border-l-danger",
  medium: "border-l-2 border-l-[var(--clay)]",
  low: "border-l-2 border-l-border",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  completed: "Review ready",
  applied: "Applied",
  discarded: "Discarded",
  failed: "Failed",
};

function ReviewStatusBadge({ review }: { review: FeedbackReviewState }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.08em]",
        review.status === "applied"
          ? "text-ok"
          : review.status === "failed"
            ? "text-danger"
            : review.status === "completed"
              ? "text-warn"
              : "text-ink-faint",
      )}
    >
      {REVIEW_STATUS_LABELS[review.status] ?? review.status}
      {review.status === "completed" && review.errorCount > 0
        ? ` · ${review.errorCount} errors`
        : ""}
    </span>
  );
}

interface PublishedPost {
  id: string;
  slug: string;
  title: string;
}

export default function SearchAnalysisPanel({
  initial,
  range,
  publishedPosts,
  feedbackReviews,
}: {
  initial: LastAnalysis | null;
  range: { preset: string; startDate: string; endDate: string };
  publishedPosts: PublishedPost[];
  feedbackReviews: FeedbackReviewMap;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [current, setCurrent] = useState<LastAnalysis | null>(initial);
  const [isRunning, startRun] = useTransition();

  const handleRun = () => {
    startRun(async () => {
      const result = await analyzeSearchPerformance(range);

      if (!result.ok) {
        toast({
          variant: "error",
          label: "Analysis failed",
          title: result.error,
        });
        return;
      }

      setCurrent({
        generatedAt: result.generatedAt,
        model: result.model,
        range,
        analysis: result.analysis,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        cost: result.cost ?? null,
      });

      toast({
        variant: "success",
        label: "Analysis ready",
        title: `${result.analysis.priorities.length} priorities and ${result.analysis.quickWins.length} quick wins.`,
      });

      router.refresh();
    });
  };

  const analysis = current?.analysis;
  const tokens =
    current && (current.inputTokens || current.outputTokens)
      ? `${(current.inputTokens ?? 0).toLocaleString("en-US")} in / ${(current.outputTokens ?? 0).toLocaleString("en-US")} out`
      : null;

  const postsBySlug = new Map(
    publishedPosts.map((post) => [post.slug, post] as const),
  );
  const activeReviews =
    current && initial && current.generatedAt === initial.generatedAt
      ? feedbackReviews
      : {};
  const generatedAt = current?.generatedAt ?? null;

  const targetFor = (item: {
    title: string;
    page?: string | null;
    why?: string;
    action: string;
  }) => {
    const slug =
      extractBlogSlug(item.page) ??
      extractBlogSlug(`${item.title} ${item.why ?? ""} ${item.action}`);
    return slug ? (postsBySlug.get(slug) ?? null) : null;
  };

  const renderReviewActions = (
    kind: FeedbackKind,
    index: number,
    item: {
      title: string;
      page?: string | null;
      why?: string;
      action: string;
    },
  ) => {
    if (!generatedAt) return null;

    const target = targetFor(item);
    const feedbackKey = makeFeedbackKey(kind, index);

    if (!target) {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-ink-muted">
          <span>
            {item.page ? (
              <>
                No published article matches{" "}
                <span className="font-mono text-[11px]">{item.page}</span>.
              </>
            ) : (
              "This is a content gap."
            )}
          </span>
          <Link
            href="/admin/new"
            className="inline-flex h-9 items-center rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground"
          >
            Create article
          </Link>
        </div>
      );
    }

    const review = activeReviews[feedbackKey];
    const runHref = `/admin/edit/${target.id}?tab=review&analysis=${encodeURIComponent(generatedAt)}&feedback=${encodeURIComponent(feedbackKey)}`;
    const viewHref = review
      ? `/admin/edit/${target.id}?tab=review&review=${encodeURIComponent(review.id)}`
      : runHref;

    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href={viewHref}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98]"
        >
          <Sparkle size={13} aria-hidden="true" />
          <span>{review ? "View review" : "Review with this feedback"}</span>
        </Link>

        {review ? (
          <Link
            href={runHref}
            className="inline-flex h-9 items-center rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground"
          >
            {review.status === "failed" ? "Retry review" : "Review again"}
          </Link>
        ) : null}

        <span className="text-[13px] text-ink-muted">
          Article: <span className="text-foreground">{target.title}</span>
        </span>
        {review ? <ReviewStatusBadge review={review} /> : null}
      </div>
    );
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            AI analysis
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Turns the Search Console digest for {range.startDate} to{" "}
            {range.endDate} into prioritized actions with the configured
            analysis model. Each recommendation can start a review of the
            matched article with that feedback attached.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning}
          className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunning ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkle size={14} aria-hidden="true" />
          )}
          <span>{isRunning ? "Analyzing..." : "Analyze with AI"}</span>
        </button>
      </header>

      {current ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          <span>{current.model}</span>
          <span>
            generated {current.generatedAt.slice(0, 16).replace("T", " ")} UTC
          </span>
          {tokens ? <span>{tokens}</span> : null}
          {current.cost !== null && current.cost !== undefined ? (
            <span>${current.cost.toFixed(4)}</span>
          ) : null}
        </p>
      ) : null}

      {analysis ? (
        <div className="mt-5 space-y-6">
          <p className="max-w-prose text-sm leading-relaxed text-foreground">
            {analysis.summary}
          </p>

          {analysis.priorities.length > 0 ? (
            <div>
              <h3 className="eyebrow text-ink-faint">Priorities</h3>
              <ol className="mt-3 space-y-3">
                {analysis.priorities.map((priority, index) => (
                  <li
                    key={`${priority.title}-${index}`}
                    className={cn(
                      "rounded border border-border bg-surface px-4 py-3",
                      IMPACT_CLASSES[priority.impact] ?? IMPACT_CLASSES.medium,
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-sm font-medium text-foreground">
                        {index + 1}. {priority.title}
                      </h4>
                      <span
                        className={cn(
                          "font-mono text-[10px] uppercase tracking-[0.08em]",
                          priority.impact === "high"
                            ? "text-danger"
                            : priority.impact === "medium"
                              ? "text-ink-muted"
                              : "text-ink-faint",
                        )}
                      >
                        {priority.impact} impact
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                      {priority.why}
                    </p>
                    {priority.section ||
                    priority.queries.length > 0 ||
                    priority.metrics ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
                        {priority.section ? (
                          <span>
                            Part:{" "}
                            <span className="text-foreground">
                              {priority.section}
                            </span>
                          </span>
                        ) : null}
                        {priority.queries.length > 0 ? (
                          <span className="font-mono text-[11px] text-ink-faint">
                            queries: {priority.queries.join(", ")}
                          </span>
                        ) : null}
                        {priority.metrics ? (
                          <span className="font-mono text-[11px] text-ink-faint">
                            {priority.metrics.clicks} clicks ·{" "}
                            {priority.metrics.impressions} impressions ·{" "}
                            {(priority.metrics.ctr * 100).toFixed(2)}% CTR ·
                            position {priority.metrics.position.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="mt-2 text-[13px] leading-relaxed text-foreground">
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                        Action{" "}
                      </span>
                      {priority.action}
                    </p>
                    {renderReviewActions("priority", index, priority)}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {analysis.quickWins.length > 0 ? (
            <div>
              <h3 className="eyebrow text-ink-faint">Quick wins</h3>
              <ul className="mt-3 space-y-2">
                {analysis.quickWins.map((win, index) => (
                  <li
                    key={`${win.title}-${index}`}
                    className="rounded border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-muted"
                  >
                    <p>
                      <span className="text-foreground">{win.title}</span>{" "}
                      {win.action}
                    </p>
                    {win.queries.length > 0 ? (
                      <p className="mt-1 font-mono text-[11px] text-ink-faint">
                        queries: {win.queries.join(", ")}
                      </p>
                    ) : null}
                    {win.metrics ? (
                      <p className="mt-1 font-mono text-[11px] text-ink-faint">
                        {win.metrics.clicks} clicks · {win.metrics.impressions}{" "}
                        impressions · {(win.metrics.ctr * 100).toFixed(2)}% CTR ·
                        position {win.metrics.position.toFixed(1)}
                      </p>
                    ) : null}
                    {renderReviewActions("quickWin", index, win)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
          No analysis yet for this dashboard. Run one to get priorities for the
          current range.
        </p>
      )}
    </section>
  );
}
