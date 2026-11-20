import { z } from "zod";
import {
  ARTICLE_LIMITS,
  countWords,
  internalBlogSlugs,
  normalizeDashes,
  sanitizeArticleHtml,
  stripHtml,
} from "@/app/lib/article-content";
import { fetchSearchQueries } from "@/app/lib/google/search-console";
import prisma from "@/app/lib/prisma";
import { getGenerationSettings } from "@/app/lib/settings";
import { buildGenerationContext } from "./blog-prompt";
import { callModel } from "./call-model";
import { MAX_AUTO_DRAFTS } from "./constants";
import { buildKeywordCandidates } from "./keywords";
import { DEFAULT_GENERATION_CHAIN, getModel, type GoModel } from "./models";
import {
  extractJsonObject,
  type ChatCompletionResult,
  type ChatMessage,
} from "./opencode-go";
import {
  getPrompt,
  PROMPT_KEYS,
  PROMPT_REGISTRY,
  renderPrompt,
} from "./prompts";
import { CURATED_TOPICS, fetchTrends, isBannedTopic, type TrendItem } from "./trends";

const RUNNING_LOCK_MINUTES = 15;
// Arbitrary constant key for pg_advisory_xact_lock; serializes run claims.
const GENERATION_CLAIM_LOCK_KEY = 724_631_001;

const MAX_TOTAL_GENERATION_MS = 260_000;
const GENERATION_REQUEST_TIMEOUT_MS = 120_000;
const GENERATION_MAX_TOKENS = 6000;
const MIN_WORD_COUNT = ARTICLE_LIMITS.minWordCount;
const MAX_WORD_COUNT = ARTICLE_LIMITS.maxWordCount;
const MAX_TITLE_SIMILARITY = 0.6;
const MIN_TITLE_LENGTH = ARTICLE_LIMITS.minTitleLength;
const MAX_TITLE_LENGTH = ARTICLE_LIMITS.maxTitleLength;
const MIN_DESCRIPTION_LENGTH = ARTICLE_LIMITS.minDescriptionLength;
const MAX_DESCRIPTION_LENGTH = ARTICLE_LIMITS.maxDescriptionLength;
const REQUIRED_SECONDARY_KEYWORDS = 4;
const MAX_TAG_WORDS = ARTICLE_LIMITS.maxTagWords;
const MAX_TAGS = ARTICLE_LIMITS.maxTags;

export const BANNED_PHRASES = [
  "in today's fast-paced",
  "in this article",
  "delve into",
  "game-changer",
  "in the ever-evolving",
  "unlock the power",
  "revolutionize",
  "deep dive",
  "in conclusion",
  "let's dive in",
  "it's important to note",
];

function findBannedPhrase(text: string): string | undefined {
  const normalized = text.toLowerCase();
  return BANNED_PHRASES.find((phrase) => normalized.includes(phrase));
}

const DraftSchema = z.object({
  title: z.string().min(5).max(200),
  slug: z.string().min(3).max(160),
  description: z.string().min(30).max(300),
  topic: z.string().min(3).max(240),
  primaryKeyword: z.string().min(2).max(100),
  secondaryKeywords: z.array(z.string().max(100)).min(1).max(8),
  readTime: z.string().max(40).optional(),
  tags: z.array(z.string()).min(1).max(8).optional(),
  html: z.string().min(500),
});

interface ValidatedDraft {
  title: string;
  slug: string;
  description: string;
  topic: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  tags: string[];
  html: string;
  wordCount: number;
}

export type GenerationResult =
  | {
      status: "skipped";
      reason: "draft_cap" | "already_running";
      detail: string;
      drafts?: number;
    }
  | {
      status: "success";
      postId: string;
      slug: string;
      model: string;
      topic: string;
      primaryKeyword: string;
      wordCount: number;
      cost?: number;
    }
  | {
      status: "failed";
      error: string;
      model?: string;
      errors?: { model: string; message: string }[];
    };

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "as",
  "at",
  "by",
  "from",
  "how",
  "why",
  "what",
  "when",
  "your",
  "you",
  "we",
  "our",
  "best",
  "guide",
  "complete",
  "ultimate",
]);

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function titleTokens(value: string): Set<string> {
  return new Set(
    slugify(value)
      .split("-")
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function titleSimilarity(a: string, b: string): number {
  const tokensA = titleTokens(a);
  const tokensB = titleTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }

  return intersection / (tokensA.size + tokensB.size - intersection);
}

export function clampDescription(value: string, max = 158): string {
  const text = value.trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const sentenceEnd = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );

  if (sentenceEnd >= 60) return cut.slice(0, sentenceEnd + 1).trim();

  const wordEnd = cut.lastIndexOf(" ");
  return (wordEnd > 0 ? cut.slice(0, wordEnd) : cut).trim();
}

function validateDraft(
  raw: unknown,
  existingTitles: string[],
  usedKeywords: Set<string>,
  publishedSlugs: Set<string>,
  forcedKeyword: string | null = null,
): ValidatedDraft {
  const parsed = DraftSchema.parse(raw);
  const normalizedTitle = normalizeDashes(parsed.title);
  const normalizedDescription = normalizeDashes(parsed.description);
  const normalizedTopic = normalizeDashes(parsed.topic);
  const html = sanitizeArticleHtml(parsed.html);
  const wordCount = countWords(html);

  if (wordCount < MIN_WORD_COUNT) {
    throw new Error(`Generated article is too short (${wordCount} words)`);
  }

  if (wordCount > MAX_WORD_COUNT) {
    throw new Error(`Generated article exceeds the concise limit (${wordCount} words)`);
  }

  if (
    normalizedTitle.length < MIN_TITLE_LENGTH ||
    normalizedTitle.length > MAX_TITLE_LENGTH
  ) {
    throw new Error(
      `Title is ${normalizedTitle.length} characters; the page appends " | David Dew Mallick", so keep it between ${MIN_TITLE_LENGTH} and ${MAX_TITLE_LENGTH}`,
    );
  }

  if (
    normalizedDescription.length < MIN_DESCRIPTION_LENGTH ||
    normalizedDescription.length > MAX_DESCRIPTION_LENGTH
  ) {
    throw new Error(
      `Meta description is ${normalizedDescription.length} characters; write one or two complete sentences between 120 and 155`,
    );
  }

  const bannedPhrase = findBannedPhrase(`${normalizedTitle} ${normalizedDescription}`);
  if (bannedPhrase) {
    throw new Error(
      `Title or description uses the banned filler phrase "${bannedPhrase}"; replace it with a specific claim`,
    );
  }

  const bannedText = `${normalizedTitle} ${normalizedDescription} ${
    parsed.tags?.join(" ") ?? ""
  } ${parsed.primaryKeyword}`;
  if (isBannedTopic(bannedText)) {
    throw new Error("Generated article violates the non-AI topic policy");
  }

  const primaryKeyword = parsed.primaryKeyword.trim().toLowerCase();
  const primarySlug = slugify(primaryKeyword);
  if (!primarySlug) {
    throw new Error("Generated primary keyword is not usable");
  }

  if (!slugify(normalizedTitle).includes(primarySlug)) {
    throw new Error(`Primary keyword "${primaryKeyword}" is missing from the title`);
  }

  const bodyText = stripHtml(html).toLowerCase();
  if (!bodyText.includes(primaryKeyword)) {
    throw new Error(
      `Primary keyword "${primaryKeyword}" never appears in the article body`,
    );
  }

  const secondaryKeywords = Array.from(
    new Set(
      parsed.secondaryKeywords
        .map((keyword) => keyword.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  );

  if (secondaryKeywords.length !== REQUIRED_SECONDARY_KEYWORDS) {
    throw new Error(
      `Expected ${REQUIRED_SECONDARY_KEYWORDS} distinct secondary keywords, received ${secondaryKeywords.length}`,
    );
  }

  const secondaryHits = secondaryKeywords.filter((keyword) =>
    bodyText.includes(keyword),
  ).length;
  if (secondaryHits < 1) {
    throw new Error(
      "None of the secondary keywords appear in the article; work at least one into the body where it fits",
    );
  }

  const tags = Array.from(
    new Set(
      (parsed.tags?.length ? parsed.tags : secondaryKeywords)
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean)
        .map((tag) => tag.split(" ").slice(0, MAX_TAG_WORDS).join(" "))
        .filter((tag) => tag.length <= ARTICLE_LIMITS.maxTagLength),
    ),
  ).slice(0, MAX_TAGS);

  const linkTargets = internalBlogSlugs(html);
  const unpublishedLink = linkTargets.find((slug) => !publishedSlugs.has(slug));
  if (unpublishedLink) {
    throw new Error(
      `Internal link "/blog/${unpublishedLink}" does not point to a published post`,
    );
  }

  const internalLinkCount = (html.match(/href="\/(?:#|blog)/g) ?? []).length;
  if (internalLinkCount < 1) {
    throw new Error(
      'Add at least one internal link to a published post or "/#projects"',
    );
  }

  const similarTitle = existingTitles.find(
    (existing) => titleSimilarity(existing, normalizedTitle) > MAX_TITLE_SIMILARITY,
  );
  if (similarTitle) {
    throw new Error(`Title is too similar to an existing post: "${similarTitle}"`);
  }

  if (forcedKeyword) {
    if (primaryKeyword !== forcedKeyword.toLowerCase()) {
      throw new Error(
        `Primary keyword must be exactly "${forcedKeyword}"; received "${primaryKeyword}"`,
      );
    }
  } else if (usedKeywords.has(primaryKeyword)) {
    throw new Error(`Primary keyword "${primaryKeyword}" was already used recently`);
  }

  const slug = slugify(parsed.slug || primaryKeyword || normalizedTitle);
  if (!slug) {
    throw new Error("Could not derive a valid slug from the generated article");
  }

  return {
    title: normalizedTitle.trim(),
    slug,
    description: clampDescription(normalizedDescription),
    topic: normalizedTopic.trim(),
    primaryKeyword,
    secondaryKeywords,
    tags,
    html,
    wordCount,
  };
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 2;

  while (await prisma.post.findUnique({ where: { slug } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 50) {
      throw new Error("Could not find a unique slug for the generated article");
    }
  }

  return slug;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function generateForModel(
  model: GoModel,
  messages: ChatMessage[],
  sessionId: string,
  existingTitles: string[],
  usedKeywords: Set<string>,
  publishedSlugs: Set<string>,
  deadline: number,
  forcedKeyword: string | null = null,
): Promise<{ draft: ValidatedDraft; result: ChatCompletionResult }> {
  let attemptMessages = messages;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (Date.now() > deadline) {
      throw new Error("Generation deadline exceeded during self-repair");
    }

    const result = await callModel({
      modelId: model.id,
      messages: attemptMessages,
      sessionId,
      temperature: 0.7,
      maxTokens: GENERATION_MAX_TOKENS,
      reasoningEffort: "none",
      timeoutMs: GENERATION_REQUEST_TIMEOUT_MS,
      deadline,
    });

    try {
      const draft = validateDraft(
        extractJsonObject(result.content),
        existingTitles,
        usedKeywords,
        publishedSlugs,
        forcedKeyword,
      );
      return { draft, result };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;

      const validationMessage =
        error instanceof Error ? error.message : "Unknown validation error";

      attemptMessages = [
        ...messages,
        { role: "assistant", content: result.content },
        {
          role: "user",
          content: `Your previous JSON failed validation: ${validationMessage}. Return the complete corrected JSON object only, keeping the same topic and all length and SEO requirements.`,
        },
      ];
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown model error");
}

export async function runBlogGeneration(
  options: { force?: boolean; keywordId?: string } = {},
): Promise<GenerationResult> {
  const startedAt = Date.now();
  const sessionId = `portfolio-blog-${new Date().toISOString()}`;

  const lockWindowStart = new Date(
    Date.now() - RUNNING_LOCK_MINUTES * 60 * 1000,
  );

  // A run killed by the platform timeout never reaches its catch block, so
  // close out any "running" row older than the lock window.
  await prisma.generationRun.updateMany({
    where: { status: "running", startedAt: { lt: lockWindowStart } },
    data: {
      status: "failed",
      finishedAt: new Date(),
      error: `Run did not finish within ${RUNNING_LOCK_MINUTES} minutes (likely killed by the function timeout)`,
    },
  });

  let forcedKeyword: string | null = null;
  if (options.keywordId) {
    const keywordRow = await prisma.keyword.findUnique({
      where: { id: options.keywordId },
      select: { keyword: true },
    });
    if (!keywordRow) {
      return {
        status: "failed",
        error: `Keyword "${options.keywordId}" was not found. Reload the keywords page and try again.`,
      };
    }
    forcedKeyword = keywordRow.keyword;
  }

  // Check-and-claim under a transaction-scoped advisory lock so concurrent
  // triggers (cron, admin button, keyword page) cannot both start a run.
  // Transaction-scoped locks work through the pgbouncer transaction pooler.
  const claim = await prisma.$transaction(async (tx) => {
    // Fixed integer key, no user input; SELECT 1 avoids Prisma's void decoding.
    await tx.$queryRawUnsafe(
      `SELECT 1 AS locked FROM pg_advisory_xact_lock(${GENERATION_CLAIM_LOCK_KEY})`,
    );

    const activeRun = await tx.generationRun.findFirst({
      where: { status: "running", startedAt: { gte: lockWindowStart } },
      select: { startedAt: true },
    });
    if (activeRun) {
      return { kind: "running" as const, startedAt: activeRun.startedAt };
    }

    const draftCount = await tx.post.count({
      where: { published: false, source: "ai" },
    });
    if (!options.force && draftCount >= MAX_AUTO_DRAFTS) {
      await tx.generationRun.create({
        data: {
          status: "skipped_cap",
          finishedAt: new Date(),
          error: `${draftCount} unreviewed AI drafts pending`,
        },
      });
      return { kind: "cap" as const, draftCount };
    }

    const run = await tx.generationRun.create({
      data: { status: "running" },
    });
    return { kind: "claimed" as const, run };
  });

  if (claim.kind === "running") {
    return {
      status: "skipped",
      reason: "already_running",
      detail: `Another generation run started at ${claim.startedAt.toISOString()}; lock window is ${RUNNING_LOCK_MINUTES} minutes`,
    };
  }

  if (claim.kind === "cap") {
    return {
      status: "skipped",
      reason: "draft_cap",
      drafts: claim.draftCount,
      detail: `${claim.draftCount} unreviewed AI drafts pending; publish or delete them to resume generation`,
    };
  }

  const { run } = claim;

  try {
    const [liveTrends, recentPosts, usedRuns, publishedPosts, searchQueries] =
      await Promise.all([
        fetchTrends().catch(() => [] as TrendItem[]),
        prisma.post.findMany({
          orderBy: { date: "desc" },
          take: 50,
          select: {
            title: true,
            slug: true,
            tags: true,
            topic: true,
            keywords: true,
            published: true,
          },
        }),
        prisma.generationRun.findMany({
          where: { status: "success", topic: { not: null } },
          orderBy: { startedAt: "desc" },
          take: 30,
          select: { topic: true },
        }),
        prisma.post.findMany({
          where: { published: true },
          select: { slug: true },
        }),
        fetchSearchQueries().catch(() => []),
      ]);

    const publishedSlugs = new Set(publishedPosts.map((post) => post.slug));

    const recentTitles = new Set(recentPosts.map((post) => normalizeTitle(post.title)));
    const recentTopics = new Set(
      recentPosts
        .map((post) => post.topic)
        .filter((topic): topic is string => Boolean(topic))
        .map(normalizeTitle),
    );
    const usedTopics = new Set(
      usedRuns
        .map((run) => run.topic)
        .filter((topic): topic is string => Boolean(topic))
        .map(normalizeTitle),
    );

    const keywordSeed: TrendItem | null = forcedKeyword
      ? { title: forcedKeyword, url: "", source: "keyword planner" }
      : null;

    const seedPool = liveTrends.length > 0 ? liveTrends : CURATED_TOPICS;
    const available = keywordSeed
      ? [keywordSeed]
      : seedPool.filter((seed) => {
          const title = normalizeTitle(seed.title);
          return (
            !recentTitles.has(title) &&
            !recentTopics.has(title) &&
            !usedTopics.has(title)
          );
        });

    const signals = (available.length > 0 ? available : CURATED_TOPICS).slice(0, 18);

    const keywordCandidates = await buildKeywordCandidates(
      forcedKeyword
        ? [forcedKeyword]
        : signals.slice(0, 3).map((signal) => signal.title),
    ).catch(() => ({ keywords: [] as string[], categories: [] as string[] }));

    const existingTitles = recentPosts.map((post) => post.title);
    const usedKeywords = new Set(
      recentPosts
        .map((post) => post.keywords[0]?.toLowerCase())
        .filter((keyword): keyword is string => Boolean(keyword)),
    );
    if (forcedKeyword) {
      usedKeywords.delete(forcedKeyword.toLowerCase());
    }

    const availableKeywords = keywordCandidates.keywords.filter(
      (keyword) => !usedKeywords.has(keyword.toLowerCase()),
    );
    const promptKeywords = forcedKeyword
      ? Array.from(new Set([forcedKeyword, ...availableKeywords])).slice(0, 12)
      : availableKeywords.length >= 12
        ? availableKeywords
        : keywordCandidates.keywords;

    const generationPrompt = await getPrompt(PROMPT_KEYS.generation);
    const generationContext = buildGenerationContext({
      trends: signals,
      recentPosts,
      today: new Date(),
      keywordCandidates: promptKeywords,
      categories: keywordCandidates.categories,
      searchQueries,
      usedKeywords: Array.from(usedKeywords),
      forcedKeyword: forcedKeyword ?? undefined,
    });
    const messages = renderPrompt(
      PROMPT_REGISTRY[PROMPT_KEYS.generation],
      generationPrompt,
      generationContext,
    );

    let lastError: unknown;
    let lastModel: string | undefined;
    const modelErrors: string[] = [];
    const structuredErrors: { model: string; message: string }[] = [];

    const { chain } = await getGenerationSettings();
    const modelChain = chain.length > 0 ? chain : DEFAULT_GENERATION_CHAIN;
    let generated: {
      model: GoModel;
      draft: ValidatedDraft;
      result: ChatCompletionResult;
    } | null = null;

    for (const selection of modelChain) {
      if (Date.now() - startedAt > MAX_TOTAL_GENERATION_MS) {
        lastError = new Error("Generation deadline exceeded before all models were tried");
        structuredErrors.push({
          model: "deadline",
          message: "Generation deadline exceeded before all models were tried",
        });
        break;
      }

      const model = getModel(selection.modelId);
      if (!model) {
        lastModel = selection.modelId;
        const message = `Unknown model id "${selection.modelId}"`;
        modelErrors.push(`${selection.modelId}: ${message}`);
        structuredErrors.push({ model: selection.modelId, message });
        continue;
      }

      try {
        const { draft, result } = await generateForModel(
          model,
          messages,
          sessionId,
          existingTitles,
          usedKeywords,
          publishedSlugs,
          startedAt + MAX_TOTAL_GENERATION_MS,
          forcedKeyword,
        );
        generated = { model, draft, result };
        break;
      } catch (error) {
        lastError = error;
        lastModel = model.id;
        const message =
          error instanceof Error ? error.message : "Unknown model error";
        modelErrors.push(`${model.id}: ${message}`);
        structuredErrors.push({ model: model.id, message });
      }
    }

    if (generated) {
      // Persistence is not a model failure: if it throws, the outer catch
      // fails the run instead of falling through to the next model and
      // generating a second article.
      const { model, draft, result } = generated;
      const slug = await ensureUniqueSlug(draft.slug);
      const readTime = `${Math.max(1, Math.round(draft.wordCount / 200))} min read`;

      const post = await prisma.$transaction(async (tx) => {
        const created = await tx.post.create({
          data: {
            title: draft.title,
            slug,
            description: draft.description,
            content: draft.html,
            readTime,
            tags: draft.tags,
            keywords: [draft.primaryKeyword, ...draft.secondaryKeywords].slice(0, 6),
            published: false,
            source: "ai",
            topic: draft.topic,
            aiModel: model.id,
            generatedAt: new Date(),
          },
        });

        if (options.keywordId && forcedKeyword) {
          // updateMany: a keyword deleted mid-run must not roll back the draft.
          await tx.keyword.updateMany({
            where: { id: options.keywordId },
            data: { status: "used", postId: created.id, usedAt: new Date() },
          });
        }

        await tx.generationRun.update({
          where: { id: run.id },
          data: {
            status: "success",
            finishedAt: new Date(),
            model: model.id,
            topic: forcedKeyword ?? draft.topic,
            postId: created.id,
            cost: result.cost ?? null,
            inputTokens: result.inputTokens ?? null,
            outputTokens: result.outputTokens ?? null,
          },
        });

        return created;
      });

      return {
        status: "success",
        postId: post.id,
        slug,
        model: model.id,
        topic: forcedKeyword ?? draft.topic,
        primaryKeyword: draft.primaryKeyword,
        wordCount: draft.wordCount,
        cost: result.cost,
      };
    }

    const message =
      modelErrors.length > 0
        ? modelErrors.join(" || ")
        : lastError instanceof Error
          ? lastError.message
          : "Unknown generation error";

    await prisma.generationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        model: lastModel ?? null,
        error: message.slice(0, 2000),
      },
    });

    return { status: "failed", error: message, model: lastModel, errors: structuredErrors };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown orchestrator error";

    await prisma.generationRun
      .update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: message.slice(0, 2000),
        },
      })
      .catch((updateError) => {
        console.error("Failed to mark generation run as failed:", updateError);
      });

    return { status: "failed", error: message };
  }
}
