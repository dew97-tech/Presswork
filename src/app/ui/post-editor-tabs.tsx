"use client";

import type { ReviewHistoryItem } from "@/app/lib/ai/review-article";
import ArticleReviewPanel from "@/app/ui/article-review-panel";
import PostForm from "@/app/ui/post-form";
import { cn } from "@/lib/utils";
import { useState, type ComponentProps } from "react";

type PostFormPost = NonNullable<ComponentProps<typeof PostForm>["post"]>;

export default function PostEditorTabs({
  post,
  current,
  initialHistory,
  reviewModelLabel,
  webSearchConfigured,
}: {
  post: PostFormPost;
  current: { title: string; description: string };
  initialHistory: ReviewHistoryItem[];
  reviewModelLabel: string;
  webSearchConfigured: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"write" | "review">("write");
  const [history, setHistory] = useState<ReviewHistoryItem[]>(initialHistory);

  const latest = history.find(
    (item) => item.status === "completed" || item.status === "applied",
  );

  return (
    <div className="w-full space-y-6">
      <div
        className="flex items-center gap-5 border-b border-border pb-3"
        role="tablist"
        aria-label="Post editor"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "write"}
          onClick={() => setActiveTab("write")}
          className={cn(
            "text-sm transition-colors",
            activeTab === "write"
              ? "text-foreground underline decoration-1 underline-offset-4"
              : "text-ink-muted hover:text-foreground",
          )}
        >
          Write
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "review"}
          onClick={() => setActiveTab("review")}
          className={cn(
            "inline-flex items-center gap-2 text-sm transition-colors",
            activeTab === "review"
              ? "text-foreground underline decoration-1 underline-offset-4"
              : "text-ink-muted hover:text-foreground",
          )}
        >
          <span>Review</span>
          {latest && (latest.errorCount > 0 || latest.warningCount > 0) ? (
            <span className="font-mono text-[11px] tabular-nums">
              {latest.errorCount > 0 ? (
                <span className="text-danger">
                  {latest.errorCount} errors
                </span>
              ) : null}
              {latest.errorCount > 0 && latest.warningCount > 0 ? (
                <span className="text-ink-faint"> · </span>
              ) : null}
              {latest.warningCount > 0 ? (
                <span className="text-warn">
                  {latest.warningCount} warnings
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
      </div>

      <div role="tabpanel" hidden={activeTab !== "write"}>
        <PostForm post={post} />
      </div>

      <div role="tabpanel" hidden={activeTab !== "review"}>
        <ArticleReviewPanel
          postId={post.id}
          current={current}
          initialHistory={initialHistory}
          reviewModelLabel={reviewModelLabel}
          webSearchConfigured={webSearchConfigured}
          onHistoryChange={setHistory}
        />
      </div>
    </div>
  );
}
