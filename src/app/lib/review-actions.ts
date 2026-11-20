"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  countWords,
  normalizeDashes,
  sanitizeArticleHtml,
} from "@/app/lib/article-content";
import {
  getStoredReview,
  runArticleReview,
  type ReviewResult,
} from "@/app/lib/ai/review-article";
import { revalidatePostSurfaces } from "@/app/lib/post-revalidate";
import { markKeywordsUsedForPost } from "@/app/lib/keyword-usage";
import prisma from "@/app/lib/prisma";
import { AI_PAUSED_MESSAGE, isAiConfigured } from "@/app/lib/ai/availability";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

const applyFieldsSchema = z
  .array(z.enum(["title", "description", "content"]))
  .min(1);

export type ReviewActionResult =
  | { ok: true; review: ReviewResult }
  | { ok: false; error: string };

export type ApplyReviewResult = { ok: true } | { ok: false; error: string };

class ApplyReviewConflict extends Error {}

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function reviewArticle(
  postId: string,
  focus?: unknown,
): Promise<ReviewActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!postId) {
    return { ok: false, error: "Missing post id." };
  }

  if (!isAiConfigured()) {
    return { ok: false, error: AI_PAUSED_MESSAGE };
  }

  try {
    const review = await runArticleReview(postId, focus);
    revalidatePath("/admin");
    revalidatePath("/admin/search-console");
    revalidatePath(`/admin/edit/${postId}`);
    return { ok: true, review };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Review failed.",
    };
  }
}

export async function applyReview(
  reviewId: string,
  fields: string[],
): Promise<ApplyReviewResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsedFields = applyFieldsSchema.safeParse(fields);
  if (!parsedFields.success) {
    return { ok: false, error: "Select at least one field to apply." };
  }

  const review = await prisma.articleReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    return { ok: false, error: "Review not found." };
  }

  if (review.status !== "completed") {
    return {
      ok: false,
      error: "This review was already applied or discarded.",
    };
  }

  const suggested = (review.suggested ?? {}) as {
    title?: string;
    description?: string;
    content?: string;
  };

  const data: Prisma.PostUpdateManyMutationInput = {};

  if (parsedFields.data.includes("title") && suggested.title) {
    data.title = suggested.title;
  }

  if (parsedFields.data.includes("description") && suggested.description) {
    data.description = suggested.description;
  }

  if (parsedFields.data.includes("content") && suggested.content) {
    const content = sanitizeArticleHtml(
      normalizeDashes(suggested.content),
    );
    if (countWords(content) < 300) {
      return {
        ok: false,
        error: "The suggested content is too short to apply.",
      };
    }
    data.content = content;
  }

  if (Object.keys(data).length === 0) {
    return {
      ok: false,
      error: "There is nothing to apply for the selected fields.",
    };
  }

  let slug: string;
  try {
    slug = await prisma.$transaction(async (tx) => {
      // Claim the review first so a double submit applies it only once.
      const claimed = await tx.articleReview.updateMany({
        where: { id: reviewId, status: "completed" },
        data: { status: "applied", appliedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ApplyReviewConflict(
          "This review was already applied or discarded.",
        );
      }

      // Only overwrite the version the review actually read.
      const updated = await tx.post.updateMany({
        where: { id: review.postId, updatedAt: { lte: review.createdAt } },
        data,
      });
      if (updated.count === 0) {
        throw new ApplyReviewConflict(
          "The article changed after this review ran. Run a new review before applying its suggestions.",
        );
      }

      const post = await tx.post.findUniqueOrThrow({
        where: { id: review.postId },
        select: { slug: true },
      });
      return post.slug;
    });
  } catch (error) {
    if (error instanceof ApplyReviewConflict) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  await markKeywordsUsedForPost(review.postId);

  revalidatePostSurfaces(slug);
  revalidatePath("/admin/search-console");
  revalidatePath(`/admin/edit/${review.postId}`);
  return { ok: true };
}

export async function discardReview(
  reviewId: string,
): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) {
    return { ok: false };
  }

  // Never turn an applied review back into a discarded one.
  const result = await prisma.articleReview.updateMany({
    where: { id: reviewId, status: { in: ["completed", "failed"] } },
    data: { status: "discarded" },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/search-console");
  return { ok: result.count > 0 };
}

export async function getReview(
  reviewId: string,
): Promise<
  { ok: true; review: ReviewResult | null } | { ok: false; error: string }
> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  const review = await getStoredReview(reviewId);
  return { ok: true, review };
}
