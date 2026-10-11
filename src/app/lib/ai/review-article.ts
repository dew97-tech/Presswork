import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/app/lib/prisma";
import { getReviewSettings } from "@/app/lib/settings";
import {
  formatSearchResults,
  searchWeb,
  type SearchResult,
} from "@/app/lib/web-search";
import { buildAuthorProfile } from "./blog-prompt";
import { callModel } from "./call-model";
import {
  BANNED_PHRASES,
  clampDescription,
  countWords,
  normalizeDashes,
  sanitizeGeneratedHtml,
  slugify,
  stripHtml,
} from "./generate-blog";
import { extractJsonObject } from "./opencode-go";
import {
  getPrompt,
  PROMPT_KEYS,
  PROMPT_REGISTRY,
  renderPrompt,
} from "./prompts";
import type { ReviewContextValues } from "./review-prompt";

const claimSchema = z.object({
  claim: z.string().min(5).max(800),
  verdict: z
    .enum(["supported", "contradicted", "unverifiable"])
    .catch("unverifiable"),
  evidence: z.string().min(3).max(1000),
  sourceTitle: z.string().max(300).nullish(),
});

const findingSchema = z.object({
  severity: z
    .enum(["error", "warning", "suggestion"])
    .catch("warning"),
  category: z
    .enum([
      "accuracy",
      "code",
      "seo",
      "structure",
      "links",
      "keywords",
      "freshness",
    ])
    .catch("accuracy"),
  title: z.string().min(3).max(200),
  detail: z.string().min(10).max(1500),
  fix: z.string().max(1000).nullish(),
  verifiedBy: z.enum(["code", "model"]).catch("model").optional(),
});

const reviewSchema = z.object({
  claims: z.array(claimSchema).optional(),
  findings: z.array(findingSchema),
  seoNotes: z
    .object({
      titleSuggestion: z.string().max(300).nullish(),
      descriptionSuggestion: z.string().max(500).nullish(),
      keywordNotes: z.string().max(1000).nullish(),
    })
    .partial()
    .optional(),
  suggested: z
    .object({
      title: z.string().max(300).nullish(),
      description: z.string().max(500).nullish(),
      content: z.string().min(200).nullish(),
    })
    .partial()
    .optional(),
  sources: z
    .array(
      z.object({
        title: z.string().max(300),
        url: z.string().max(1000),
      }),
    )
    .optional(),
});

export type ReviewClaim = z.infer<typeof claimSchema>;
export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewSeoNotes = {
  titleSuggestion?: string | null;
  descriptionSuggestion?: string | null;
  keywordNotes?: string | null;
};
export type ReviewSuggested = {
  title?: string | null;
  description?: string | null;
  content?: string | null;
};

export interface ReviewResult {
  reviewId: string;
  postId: string;
  model: string;
  status: string;
  usedWebSearch: boolean;
  degradedSearch: boolean;
  claims: ReviewClaim[];
  findings: ReviewFinding[];
  seoNotes: ReviewSeoNotes | null;
  suggested: ReviewSuggested | null;
  sources: Array<{ title: string; url: string }>;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  createdAt: string;
}

export interface ReviewHistoryItem {
  id: string;
  model: string;
  status: string;
  findingCount: number;
  errorCount: number;
  warningCount: number;
  error?: string | null;
  createdAt: string;
}

export async function listRecentReviews(
  postId: string,
  take = 5,
): Promise<ReviewHistoryItem[]> {
  const reviews = await prisma.articleReview.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      model: true,
      status: true,
      findings: true,
      error: true,
      createdAt: true,
    },
  });

  return reviews.map((review) => {
    const findings = Array.isArray(review.findings) ? review.findings : [];
    const severities = findings.map(
      (finding) => (finding as { severity?: string }).severity,
    );

    return {
      id: review.id,
      model: review.model,
      status: review.status,
      findingCount: findings.length,
      errorCount: severities.filter((severity) => severity === "error").length,
      warningCount: severities.filter((severity) => severity === "warning")
        .length,
      error: review.error,
      createdAt: review.createdAt.toISOString(),
    };
  });
}

export async function getStoredReview(
  reviewId: string,
): Promise<ReviewResult | null> {
  const review = await prisma.articleReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    return null;
  }

  const degradedSearch =
    review.status === "completed" && !review.usedWebSearch;

  return {
    reviewId: review.id,
    postId: review.postId,
    model: review.model,
    status: review.status,
    usedWebSearch: review.usedWebSearch,
    degradedSearch,
    claims: (review.claims as ReviewClaim[] | null) ?? [],
    findings: (review.findings as ReviewFinding[] | null) ?? [],
    seoNotes: (review.seoNotes as ReviewSeoNotes | null) ?? null,
    suggested: (review.suggested as ReviewSuggested | null) ?? null,
    sources:
      (review.sources as Array<{ title: string; url: string }> | null) ?? [],
    inputTokens: review.inputTokens ?? undefined,
    outputTokens: review.outputTokens ?? undefined,
    cost: review.cost ?? undefined,
    createdAt: review.createdAt.toISOString(),
  };
}

function buildSearchQueries(post: {
  title: string;
  keywords: string[];
}): string[] {
  const candidates = [
    post.keywords[0] ?? "",
    post.title,
    post.keywords[1] ?? "",
  ];

  const seen = new Set<string>();
  return candidates
    .map((query) => query.trim())
    .filter((query) => {
      if (query.length < 3 || seen.has(query.toLowerCase())) {
        return false;
      }
      seen.add(query.toLowerCase());
      return true;
    })
    .slice(0, 3);
}

const EXTERNAL_DOC_DOMAINS = [
  "laravel.com",
  "php.net",
  "postgresql.org",
  "developer.mozilla.org",
  "redis.io",
  "docker.com",
];

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DASH_PATTERN = new RegExp(`[${EM_DASH}${EN_DASH}]`, "g");

export function runDeterministicChecks(
  post: {
    title: string;
    description: string;
    content: string;
    keywords: string[];
  },
  publishedSlugs: Set<string>,
): { findings: ReviewFinding[]; missingLinks: string[] } {
  const findings: ReviewFinding[] = [];
  const add = (finding: Omit<ReviewFinding, "verifiedBy">) => {
    findings.push({ ...finding, verifiedBy: "code" });
  };

  const blogLinks = Array.from(
    post.content.matchAll(/href="\/blog\/([a-z0-9-]+)"/g),
    (match) => match[1],
  );
  const missingLinks = Array.from(
    new Set(blogLinks.filter((slug) => !publishedSlugs.has(slug))),
  );
  for (const slug of missingLinks) {
    add({
      severity: "error",
      category: "links",
      title: "Internal link target is not published",
      detail: `The article links to "/blog/${slug}", which is not a published post.`,
      fix: "Fix the link or publish the target.",
    });
  }

  const titleLength = post.title.length;
  if (titleLength < 25 || titleLength > 70) {
    add({
      severity: "error",
      category: "seo",
      title: "Title length is outside the allowed bounds",
      detail: `The title is ${titleLength} characters; the page requires 25 to 70.`,
      fix: "Rewrite the title to 35 to 50 characters.",
    });
  }

  const descriptionLength = post.description.length;
  if (descriptionLength < 70 || descriptionLength > 190) {
    add({
      severity: "error",
      category: "seo",
      title: "Meta description length is outside the allowed bounds",
      detail: `The description is ${descriptionLength} characters; write one or two sentences between 120 and 155.`,
      fix: "Rewrite the description.",
    });
  } else if (descriptionLength < 120 || descriptionLength > 155) {
    add({
      severity: "warning",
      category: "seo",
      title: "Meta description length is not ideal",
      detail: `The description is ${descriptionLength} characters; the target range is 120 to 155.`,
      fix: "Tighten or expand the description.",
    });
  }

  const primaryKeyword = (post.keywords[0] ?? "").trim().toLowerCase();
  if (!primaryKeyword) {
    add({
      severity: "suggestion",
      category: "keywords",
      title: "No primary keyword recorded",
      detail:
        "This post stores no keywords, so keyword alignment cannot be checked and future generation cannot avoid colliding with it.",
      fix: "Add keywords in the editor.",
    });
  } else {
    const keywordSlug = slugify(primaryKeyword);
    if (keywordSlug && !slugify(post.title).includes(keywordSlug)) {
      add({
        severity: "error",
        category: "keywords",
        title: "Primary keyword is missing from the title",
        detail: `The primary keyword "${primaryKeyword}" does not appear in the title.`,
        fix: "Work the keyword into the title naturally.",
      });
    }

    const bodyText = stripHtml(post.content).toLowerCase();
    if (!bodyText.includes(primaryKeyword)) {
      add({
        severity: "error",
        category: "keywords",
        title: "Primary keyword is missing from the body",
        detail: `The primary keyword "${primaryKeyword}" never appears in the article body.`,
        fix: "Use the keyword where it fits naturally.",
      });
    }
  }

  const dashCount = (post.content.match(DASH_PATTERN) ?? []).length;
  if (dashCount > 0) {
    add({
      severity: "error",
      category: "structure",
      title: "Em or en dash found in content",
      detail: `The article contains ${dashCount} em or en dash characters.`,
      fix: "Replace them with hyphens, commas, or colons.",
    });
  }

  const plainText =
    `${post.title} ${post.description} ${stripHtml(post.content)}`.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (plainText.includes(phrase)) {
      add({
        severity: "error",
        category: "structure",
        title: "Banned filler phrase found",
        detail: `The article contains the banned phrase "${phrase}".`,
        fix: "Replace it with a specific claim.",
      });
    }
  }

  if (/<h1[\s>]/i.test(post.content)) {
    add({
      severity: "error",
      category: "structure",
      title: "Article contains an h1",
      detail:
        "The page template renders the title as the only h1; the article body must start at h2.",
      fix: "Demote the heading to h2 or remove it.",
    });
  }

  if (/<(script|iframe|style)[\s>]/i.test(post.content)) {
    add({
      severity: "error",
      category: "structure",
      title: "Article contains a forbidden tag",
      detail: "script, iframe, and style tags are not allowed in article content.",
      fix: "Remove the tag.",
    });
  }

  if (/\son[a-z]+\s*=/i.test(post.content)) {
    add({
      severity: "error",
      category: "structure",
      title: "Article contains an inline event handler",
      detail: "on* attributes are not allowed in article content.",
      fix: "Remove the attribute.",
    });
  }

  if (/\sstyle\s*=/i.test(post.content)) {
    add({
      severity: "warning",
      category: "structure",
      title: "Article contains an inline style attribute",
      detail: "Inline styles bypass the design system.",
      fix: "Remove the style attribute and use the allowed component classes.",
    });
  }

  const words = countWords(post.content);
  if (words < 900 || words > 2600) {
    add({
      severity: "warning",
      category: "structure",
      title: "Article length is outside the target band",
      detail: `The article is ${words} words; the target is 900 to 2600.`,
      fix: "Trim padding or expand thin sections.",
    });
  }

  const externalLinks = Array.from(
    post.content.matchAll(/href="(https?:\/\/[^"]+)"/g),
    (match) => match[1],
  );
  const disallowed = Array.from(
    new Set(
      externalLinks.filter((url) => {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "");
          return !EXTERNAL_DOC_DOMAINS.some(
            (domain) => host === domain || host.endsWith(`.${domain}`),
          );
        } catch {
          return true;
        }
      }),
    ),
  );
  if (disallowed.length > 0) {
    add({
      severity: "suggestion",
      category: "links",
      title: "External links outside the documentation allowlist",
      detail: `Non-documentation links: ${disallowed.slice(0, 4).join(", ")}${
        disallowed.length > 4 ? ` (+${disallowed.length - 4} more)` : ""
      }.`,
      fix: "Prefer official documentation links where they support a claim.",
    });
  }

  return { findings, missingLinks };
}

function postProcessSuggested(
  suggested: ReviewSuggested | undefined,
  publishedSlugs: Set<string>,
  findings: ReviewFinding[],
): ReviewSuggested | null {
  if (!suggested) {
    return null;
  }

  const result: ReviewSuggested = {};

  if (suggested.title) {
    const title = normalizeDashes(suggested.title.trim());
    if (title.length >= 25 && title.length <= 70) {
      result.title = title;
    } else {
      findings.push({
        severity: "warning",
        category: "seo",
        title: "Suggested title discarded",
        verifiedBy: "code",
        detail: `The rewritten title was ${title.length} characters; the page requires 25 to 70 before the site suffix.`,
        fix: "Adjust the title manually or rerun the review.",
      });
    }
  }

  if (suggested.description) {
    result.description = clampDescription(
      normalizeDashes(suggested.description.trim()),
    );
  }

  if (suggested.content) {
    const html = sanitizeGeneratedHtml(normalizeDashes(suggested.content));
    const words = countWords(html);
    const invalidLink = Array.from(
      html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g),
      (match) => match[1],
    ).find((slug) => !publishedSlugs.has(slug));

    if (words < 300) {
      findings.push({
        severity: "warning",
        category: "structure",
        title: "Suggested rewrite discarded",
        verifiedBy: "code",
        detail: `The rewritten article was only ${words} words, so it was not offered for apply.`,
        fix: "Rerun the review or edit the article manually.",
      });
    } else if (invalidLink) {
      findings.push({
        severity: "warning",
        category: "links",
        title: "Suggested rewrite discarded",
        verifiedBy: "code",
        detail: `The rewritten article linked to "/blog/${invalidLink}", which is not a published post.`,
        fix: "Fix the internal link and rerun the review.",
      });
    } else {
      result.content = html;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function persistFailure(
  postId: string,
  model: string,
  error: unknown,
): Promise<string> {
  const message =
    error instanceof Error ? error.message : "Unknown article review error";

  await prisma.articleReview
    .create({
      data: {
        postId,
        model,
        status: "failed",
        error: message.slice(0, 2000),
      },
    })
    .catch((persistError) => {
      console.error("Failed to persist review failure:", persistError);
    });

  return message;
}

export async function runArticleReview(postId: string): Promise<ReviewResult> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    throw new Error("Post not found.");
  }

  const settings = await getReviewSettings();

  const publishedPosts = await prisma.post.findMany({
    where: { published: true },
    select: { title: true, slug: true },
  });
  const publishedSlugs = new Set(publishedPosts.map((entry) => entry.slug));

  let searchResults: SearchResult[] = [];
  let degradedSearch = true;

  if (settings.webSearch) {
    const outcome = await searchWeb(buildSearchQueries(post), 3);
    searchResults = outcome.results;
    degradedSearch = outcome.degraded;
  }

  const context: ReviewContextValues = {
    today: new Date().toISOString().slice(0, 10),
    articleTitle: post.title,
    articleDescription: post.description,
    articleSlug: post.slug,
    articlePrimaryKeyword: post.keywords[0] ?? "(none recorded)",
    articleKeywords: post.keywords.join(", ") || "(none recorded)",
    articleTags: post.tags.join(", ") || "(none recorded)",
    articleContent: post.content,
    searchResults: formatSearchResults(searchResults),
    publishedPosts:
      publishedPosts.length > 0
        ? publishedPosts
            .map((entry) => `- ${entry.title} (/blog/${entry.slug})`)
            .join("\n")
        : "No published posts yet.",
    authorProfile: buildAuthorProfile(),
  };

  const prompt = await getPrompt(PROMPT_KEYS.review);
  const messages = renderPrompt(
    PROMPT_REGISTRY[PROMPT_KEYS.review],
    prompt,
    context,
  );

  let modelResult;
  try {
    modelResult = await callModel({
      modelId: settings.modelId,
      messages,
      sessionId: `portfolio-review-${postId}-${Date.now()}`,
      temperature: 0.3,
      maxTokens: 8000,
      reasoningEffort: settings.reasoningEffort,
      timeoutMs: 180_000,
    });
  } catch (error) {
    const message = await persistFailure(
      postId,
      settings.modelId,
      error,
    );
    throw new Error(`Review model failed: ${message}`);
  }

  let parsed: z.infer<typeof reviewSchema>;
  try {
    parsed = reviewSchema.parse(extractJsonObject(modelResult.content));
  } catch (error) {
    const message = await persistFailure(
      postId,
      settings.modelId,
      "The review model returned a response that did not match the required JSON contract.",
    );
    console.error("Review JSON validation failed:", error);
    throw new Error(message);
  }

  const deterministic = runDeterministicChecks(post, publishedSlugs);
  const missingLinkSet = new Set(deterministic.missingLinks);

  const claims = (parsed.claims ?? []).slice(0, 20);
  const sources = (parsed.sources ?? [])
    .filter((source) => /^https?:\/\//i.test(source.url))
    .slice(0, 10);

  const modelFindings: ReviewFinding[] = parsed.findings
    .slice(0, 30)
    .map((finding) => ({
      ...finding,
      verifiedBy: finding.verifiedBy ?? "model",
    }));

  const filteredModelFindings = modelFindings.filter((finding) => {
    if (finding.category !== "links") {
      return true;
    }

    if (missingLinkSet.size === 0) {
      return false;
    }

    return !Array.from(missingLinkSet).some(
      (slug) => finding.detail.includes(slug) || finding.title.includes(slug),
    );
  });

  const severityOrder: Record<string, number> = {
    error: 0,
    warning: 1,
    suggestion: 2,
  };
  const findings = [...deterministic.findings, ...filteredModelFindings].sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
  );

  const suggested = postProcessSuggested(
    parsed.suggested,
    publishedSlugs,
    findings,
  );

  const review = await prisma.articleReview.create({
    data: {
      postId,
      model: settings.modelId,
      status: "completed",
      usedWebSearch: searchResults.length > 0,
      claims: claims as Prisma.InputJsonValue,
      findings: findings as Prisma.InputJsonValue,
      seoNotes: (parsed.seoNotes ?? null) as Prisma.InputJsonValue,
      suggested: (suggested ?? null) as Prisma.InputJsonValue,
      sources: sources as Prisma.InputJsonValue,
      inputTokens: modelResult.inputTokens ?? null,
      outputTokens: modelResult.outputTokens ?? null,
      cost: modelResult.cost ?? null,
    },
  });

  return {
    reviewId: review.id,
    postId,
    model: settings.modelId,
    status: "completed",
    usedWebSearch: searchResults.length > 0,
    degradedSearch,
    claims,
    findings,
    seoNotes: parsed.seoNotes ?? null,
    suggested,
    sources,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
    cost: modelResult.cost,
    createdAt: review.createdAt.toISOString(),
  };
}
