"use server";

import { runBlogGeneration } from "@/app/lib/ai/generate-blog";
import { callModel } from "@/app/lib/ai/call-model";
import {
  buildImagePromptMessages,
  cleanImagePrompt,
  fallbackImagePrompt,
} from "@/app/lib/ai/image-prompt";
import { getModel } from "@/app/lib/ai/models";
import { getGenerationSettings, getImageSettings } from "@/app/lib/settings";
import prisma from "@/app/lib/prisma";
import { revalidatePostSurfaces } from "@/app/lib/post-revalidate";
import {
  markKeywordsUsedForPost,
  resetKeywordsForPost,
} from "@/app/lib/keyword-usage";
import { auth } from "@/auth";
import { deleteBlobIfUnused } from "@/app/lib/blob";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";

const PostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  readTime: z.string().min(1),
  tags: z.string(),
  thumbnail: z.string().optional(),
  published: z.preprocess(
    (val) => val === true || val === "true" || val === "on" || val === 1 || val === "1",
    z.boolean(),
  ),
});

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

function normalizeDashes(text: string) {
  return text
    .replaceAll(` ${EM_DASH} `, ", ")
    .replaceAll(` ${EN_DASH} `, ", ")
    .replaceAll(EM_DASH, "-")
    .replaceAll(EN_DASH, "-");
}

type PostFormState =
  | {
      message?: string;
      errors?: Record<string, string[] | undefined>;
    }
  | null
  | undefined;

const SLUG_CONFLICT_ERRORS = {
  slug: ["A post with this slug already exists. Please choose a unique slug."],
};

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function createPost(prevState: PostFormState, formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    return { message: "Unauthorized" };
  }

  const validatedFields = PostSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    content: formData.get("content"),
    readTime: formData.get("readTime"),
    tags: formData.get("tags"),
    thumbnail: formData.get("thumbnail"),
    published: formData.get("published"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Create Post.",
    };
  }

  const { title, slug, description, content, readTime, tags, thumbnail, published } =
    validatedFields.data;

  const tagsArray = tags
    .split(",")
    .map((tag) => normalizeDashes(tag.trim()))
    .filter(Boolean);

  const existingPost = await prisma.post.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (existingPost) {
    return {
      errors: SLUG_CONFLICT_ERRORS,
      message: "Slug Conflict: Failed to Create Post.",
    };
  }

  try {
    const post = await prisma.post.create({
      data: {
        title: normalizeDashes(title),
        slug,
        description: normalizeDashes(description),
        content: normalizeDashes(content),
        readTime,
        tags: tagsArray,
        thumbnail,
        published,
        publishedAt: published ? new Date() : null,
      },
    });
    await markKeywordsUsedForPost(post.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        errors: SLUG_CONFLICT_ERRORS,
        message: "Slug Conflict: Failed to Create Post.",
      };
    }
    return { message: "Database Error: Failed to Create Post." };
  }

  revalidatePostSurfaces(slug);
  redirect("/admin");
}

export async function updatePost(
  id: string,
  prevState: PostFormState,
  formData: FormData,
) {
  const session = await auth();
  if (!session?.user) {
    return { message: "Unauthorized" };
  }

  const validatedFields = PostSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    content: formData.get("content"),
    readTime: formData.get("readTime"),
    tags: formData.get("tags"),
    thumbnail: formData.get("thumbnail"),
    published: formData.get("published"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Update Post.",
    };
  }

  const { title, slug, description, content, readTime, tags, thumbnail, published } =
    validatedFields.data;

  const tagsArray = tags
    .split(",")
    .map((tag) => normalizeDashes(tag.trim()))
    .filter(Boolean);

  const previous = await prisma.post.findUnique({
    where: { id },
    select: { slug: true, thumbnail: true, publishedAt: true },
  });

  if (!previous) {
    return { message: "Database Error: Failed to Update Post." };
  }

  try {
    const post = await prisma.post.update({
      where: { id },
      data: {
        title: normalizeDashes(title),
        slug,
        description: normalizeDashes(description),
        content: normalizeDashes(content),
        readTime,
        tags: tagsArray,
        thumbnail,
        published,
        ...(published && !previous.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
    });
    await markKeywordsUsedForPost(post.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        errors: SLUG_CONFLICT_ERRORS,
        message: "Slug Conflict: Failed to Update Post.",
      };
    }
    return { message: "Database Error: Failed to Update Post." };
  }

  if (
    typeof thumbnail === "string" &&
    previous.thumbnail &&
    previous.thumbnail !== thumbnail
  ) {
    await deleteBlobIfUnused(previous.thumbnail);
  }

  revalidatePostSurfaces(previous.slug, slug);
  redirect("/admin");
}

export interface DeletePostResult {
  ok: boolean;
  error?: string;
}

export async function deletePost(id: string): Promise<DeletePostResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true, thumbnail: true },
  });

  if (!existing) {
    return { ok: false, error: "Post not found." };
  }

  try {
    await prisma.post.delete({
      where: { id },
    });

    await resetKeywordsForPost(id);

    if (existing.thumbnail) {
      await deleteBlobIfUnused(existing.thumbnail);
    }

    revalidatePostSurfaces(existing.slug);
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete post:", error);
    return { ok: false, error: "Delete failed. Check the server logs." };
  }
}

export interface GenerationActionState {
  status: "success" | "skipped" | "failed";
  message: string;
  detail?: string;
}

export async function triggerGeneration(
  _prevState: GenerationActionState | null,
  _formData: FormData,
): Promise<GenerationActionState> {
  const session = await auth();
  if (!session?.user) {
    return { status: "failed", message: "Unauthorized" };
  }

  const result = await runBlogGeneration({ force: true });

  revalidatePostSurfaces();

  if (result.status === "success") {
    return {
      status: "success",
      message: `Draft created: ${result.slug} (${result.wordCount} words)`,
    };
  }

  if (result.status === "skipped") {
    return { status: "skipped", message: result.detail };
  }

  const modelErrors =
    result.errors?.filter((entry) => entry.model !== "deadline") ?? [];
  const { chain } = await getGenerationSettings();
  const chainLength = chain.length > 0 ? chain.length : 1;
  const message =
    modelErrors.length >= chainLength
      ? `Tried all ${chainLength} models. None produced a valid draft.`
      : "Generation failed before a draft passed validation.";
  const detail = result.errors?.length
    ? result.errors
        .map((entry) => `${entry.model}: ${entry.message}`)
        .join("\n")
        .slice(0, 1500)
    : result.error.slice(0, 1500);

  return { status: "failed", message, detail };
}

export interface ImagePromptActionState {
  prompt?: string;
  message?: string;
}

export async function generateImagePrompt(input: {
  title: string;
  description: string;
  topic: string;
  keywords: string[];
  tags: string[];
  content: string;
}): Promise<ImagePromptActionState> {
  const session = await auth();
  if (!session?.user) {
    return { message: "Unauthorized" };
  }

  const context = {
    title: input.title.trim(),
    description: input.description.trim(),
    topic: input.topic.trim() || null,
    keywords: input.keywords.map((keyword) => keyword.trim()).filter(Boolean),
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    content: input.content,
  };

  if (context.title.length === 0 && context.description.length === 0) {
    return { message: "Add a title or summary first" };
  }

  try {
    const imageSettings = await getImageSettings();
    const model =
      getModel(imageSettings.modelId) ?? getModel("glm-5.3-flash");
    if (!model) {
      return { prompt: fallbackImagePrompt(context) };
    }

    const result = await callModel({
      modelId: model.id,
      messages: buildImagePromptMessages(context),
      sessionId: `portfolio-cover-${Date.now()}`,
      temperature: 0.8,
      maxTokens: 1_200,
      timeoutMs: 40_000,
      jsonMode: false,
      reasoningEffort: imageSettings.reasoningEffort,
    });

    const prompt = cleanImagePrompt(result.content);
    return { prompt: prompt.length >= 120 ? prompt : fallbackImagePrompt(context) };
  } catch {
    return { prompt: fallbackImagePrompt(context) };
  }
}
