import sanitizeHtml from "sanitize-html";
import { z } from "zod";
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

const MAX_TOTAL_GENERATION_MS = 260_000;
const GENERATION_REQUEST_TIMEOUT_MS = 120_000;
const GENERATION_MAX_TOKENS = 6000;
const MIN_WORD_COUNT = 900;
const MAX_WORD_COUNT = 2_600;
const MAX_TITLE_SIMILARITY = 0.6;
const MIN_TITLE_LENGTH = 25;
const MAX_TITLE_LENGTH = 70;
const MIN_DESCRIPTION_LENGTH = 70;
const MAX_DESCRIPTION_LENGTH = 190;
const REQUIRED_SECONDARY_KEYWORDS = 4;
const MAX_TAG_WORDS = 3;
const MAX_TAGS = 4;

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
  secondaryKeywords: z.array(z.string()).min(1).max(8),
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

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(html: string): number {
  const text = stripHtml(html);
  return text ? text.split(" ").length : 0;
}

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

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

export function normalizeDashes(text: string): string {
  return text
    .replaceAll(` ${EM_DASH} `, ", ")
    .replaceAll(` ${EN_DASH} `, ", ")
    .replaceAll(EM_DASH, "-")
    .replaceAll(EN_DASH, "-");
}

export function sanitizeGeneratedHtml(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: [
      "h2",
      "h3",
      "h4",
      "p",
      "a",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "code",
      "pre",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "br",
      "div",
      "span",
      "mark",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
      div: ["class"],
      pre: ["class"],
      table: ["class"],
    },
    allowedClasses: {
      div: ["highlight-box", "pro-tip", "table-wrapper"],
      pre: ["code-snippet"],
      table: ["comparison-table"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });

  return normalizeDashes(clean);
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
  const html = sanitizeGeneratedHtml(parsed.html);
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
        .map((tag) => tag.split(" ").slice(0, MAX_TAG_WORDS).join(" ")),
    ),
  ).slice(0, MAX_TAGS);

  const linkTargets = Array.from(
    html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g),
    (match) => match[1],
  );
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

  const activeRun = await prisma.generationRun.findFirst({
    where: {
      status: "running",
      startedAt: { gte: new Date(Date.now() - RUNNING_LOCK_MINUTES * 60 * 1000) },
    },
    select: { startedAt: true },
  });

  if (activeRun) {
    return {
      status: "skipped",
      reason: "already_running",
      detail: `Another generation run started at ${activeRun.startedAt.toISOString()}; lock window is ${RUNNING_LOCK_MINUTES} minutes`,
    };
  }

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

  const draftCount = await prisma.post.count({
    where: { published: false, source: "ai" },
  });

  if (!options.force && draftCount >= MAX_AUTO_DRAFTS) {
    await prisma.generationRun.create({
      data: {
        status: "skipped_cap",
        finishedAt: new Date(),
        error: `${draftCount} unreviewed AI drafts pending`,
      },
    });
    return {
      status: "skipped",
      reason: "draft_cap",
      drafts: draftCount,
      detail: `${draftCount} unreviewed AI drafts pending; publish or delete them to resume generation`,
    };
  }

  const run = await prisma.generationRun.create({
    data: { status: "running" },
  });

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

        const slug = await ensureUniqueSlug(draft.slug);
        const readTime = `${Math.max(1, Math.round(draft.wordCount / 200))} min read`;

        const post = await prisma.post.create({
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
          await prisma.keyword.update({
            where: { id: options.keywordId },
            data: { status: "used", postId: post.id, usedAt: new Date() },
          });
        }

        await prisma.generationRun
          .update({
            where: { id: run.id },
            data: {
              status: "success",
              finishedAt: new Date(),
              model: model.id,
              topic: forcedKeyword ?? draft.topic,
              postId: post.id,
              cost: result.cost ?? null,
              inputTokens: result.inputTokens ?? null,
              outputTokens: result.outputTokens ?? null,
            },
          })
          .catch((error) => {
            console.error("Failed to record generation run telemetry:", error);
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
      } catch (error) {
        lastError = error;
        lastModel = model.id;
        const message =
          error instanceof Error ? error.message : "Unknown model error";
        modelErrors.push(`${model.id}: ${message}`);
        structuredErrors.push({ model: model.id, message });
      }
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
      .catch(() => undefined);

    return { status: "failed", error: message };
  }
}
