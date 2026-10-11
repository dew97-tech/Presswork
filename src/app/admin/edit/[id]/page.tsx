import { getModel } from "@/app/lib/ai/models";
import { listRecentReviews } from "@/app/lib/ai/review-article";
import prisma from "@/app/lib/prisma";
import { getReviewSettings } from "@/app/lib/settings";
import { isWebSearchConfigured } from "@/app/lib/web-search";
import PostEditorTabs from "@/app/ui/post-editor-tabs";
import { notFound } from "next/navigation";

export const maxDuration = 300;

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    notFound();
  }

  const [reviews, reviewSettings] = await Promise.all([
    listRecentReviews(post.id),
    getReviewSettings(),
  ]);

  const reviewModelLabel =
    getModel(reviewSettings.modelId)?.label ?? reviewSettings.modelId;

  return (
    <PostEditorTabs
      post={post}
      current={{ title: post.title, description: post.description }}
      initialHistory={reviews}
      reviewModelLabel={reviewModelLabel}
      webSearchConfigured={isWebSearchConfigured()}
    />
  );
}
