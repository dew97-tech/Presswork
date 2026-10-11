"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  countWords,
  normalizeDashes,
  sanitizeGeneratedHtml,
} from "@/app/lib/ai/generate-blog";
import {
  getStoredReview,
  runArticleReview,
  type ReviewResult,
} from "@/app/lib/ai/review-article";
import { revalidatePostSurfaces } from "@/app/lib/post-revalidate";
import { markKeywordsUsedForPost } from "@/app/lib/keyword-usage";
import prisma from "@/app/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

const applyFieldsSchema = z
  .array(z.enum(["title", "description", "content"]))
  .min(1);

export type ReviewActionResult =
  | { ok: true; review: ReviewResult }
  | { ok: false; error: string };

export type ApplyReviewResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function reviewArticle(
  postId: string,
): Promise<ReviewActionResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!postId) {
    return { ok: false, error: "Missing post id." };
  }

  try {
    const review = await runArticleReview(postId);
    revalidatePath("/admin");
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

  const data: Prisma.PostUpdateInput = {};

  if (parsedFields.data.includes("title") && suggested.title) {
    data.title = suggested.title;
  }

  if (parsedFields.data.includes("description") && suggested.description) {
    data.description = suggested.description;
  }

  if (parsedFields.data.includes("content") && suggested.content) {
    const content = sanitizeGeneratedHtml(
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

  const post = await prisma.post.update({
    where: { id: review.postId },
    data,
  });

  await markKeywordsUsedForPost(post.id);

  await prisma.articleReview.update({
    where: { id: reviewId },
    data: { status: "applied", appliedAt: new Date() },
  });

  revalidatePostSurfaces(post.slug);
  return { ok: true };
}

export async function discardReview(
  reviewId: string,
): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) {
    return { ok: false };
  }

  await prisma.articleReview
    .update({
      where: { id: reviewId },
      data: { status: "discarded" },
    })
    .catch(() => undefined);

  revalidatePath("/admin");
  return { ok: true };
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
