import { getModel } from "@/app/lib/ai/models";
import {
  getStoredReview,
  listRecentReviews,
} from "@/app/lib/ai/review-article";
import prisma from "@/app/lib/prisma";
import {
  buildReviewFocus,
  extractBlogSlug,
  parseFeedbackKey,
  type ReviewFocus,
} from "@/app/lib/google/feedback";
import { getLastAnalysis, getReviewSettings } from "@/app/lib/settings";
import { isWebSearchConfigured } from "@/app/lib/web-search";
import PostEditorTabs from "@/app/ui/post-editor-tabs";
import { notFound } from "next/navigation";

export const maxDuration = 300;

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EditPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const post = await prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    notFound();
  }

  const [reviews, reviewSettings, lastAnalysis] = await Promise.all([
    listRecentReviews(post.id),
    getReviewSettings(),
    getLastAnalysis(),
  ]);

  const reviewModelLabel =
    getModel(reviewSettings.modelId)?.label ?? reviewSettings.modelId;

  const requestedReviewId = firstValue(query.review);
  const storedReview = requestedReviewId
    ? await getStoredReview(requestedReviewId)
    : null;
  const initialReview =
    storedReview && storedReview.postId === post.id ? storedReview : null;

  let initialFocus: ReviewFocus | null = null;
  const feedbackKey = firstValue(query.feedback);
  const analysisGeneratedAt = firstValue(query.analysis);

  if (
    !initialReview &&
    feedbackKey &&
    lastAnalysis &&
    (!analysisGeneratedAt ||
      lastAnalysis.generatedAt === analysisGeneratedAt) &&
    parseFeedbackKey(feedbackKey)
  ) {
    initialFocus = buildReviewFocus(
      lastAnalysis.analysis,
      {
        generatedAt: lastAnalysis.generatedAt,
        range: {
          startDate: lastAnalysis.range.startDate,
          endDate: lastAnalysis.range.endDate,
        },
      },
      feedbackKey,
    );

    const focusSlug = initialFocus
      ? extractBlogSlug(initialFocus.page)
      : null;
    if (focusSlug && focusSlug !== post.slug) {
      initialFocus = null;
    }
  }

  const initialTab =
    initialReview || initialFocus || firstValue(query.tab) === "review"
      ? "review"
      : "write";

  return (
    <PostEditorTabs
      post={post}
      current={{ title: post.title, description: post.description }}
      initialHistory={reviews}
      reviewModelLabel={reviewModelLabel}
      webSearchConfigured={isWebSearchConfigured()}
      initialTab={initialTab}
      initialFocus={initialFocus}
      initialReview={initialReview}
      autoStart={Boolean(initialFocus && !initialReview)}
    />
  );
}
