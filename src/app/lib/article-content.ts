import sanitizeHtml from "sanitize-html";

/**
 * Article content policy shared by every path that writes or renders a Post:
 * the editor, AI generation, AI review, and the public article page.
 */

export const ARTICLE_LIMITS = {
  minTitleLength: 25,
  maxTitleLength: 70,
  minDescriptionLength: 70,
  maxDescriptionLength: 190,
  minWordCount: 900,
  maxWordCount: 2_600,
  maxTags: 4,
  maxTagWords: 3,
  maxTagLength: 40,
} as const;

export const EM_DASH = String.fromCharCode(0x2014);
export const EN_DASH = String.fromCharCode(0x2013);

export function normalizeDashes(text: string): string {
  return text
    .replaceAll(` ${EM_DASH} `, ", ")
    .replaceAll(` ${EN_DASH} `, ", ")
    .replaceAll(EM_DASH, "-")
    .replaceAll(EN_DASH, "-");
}

export function sanitizeArticleHtml(html: string): string {
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
      "section",
      "article",
      "col",
      "colgroup",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
      col: ["span"],
      colgroup: ["span"],
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
    transformTags: {
      // A link that opens a new browsing context must not hand it window.opener.
      a: (tagName, attribs) =>
        attribs.target
          ? { tagName, attribs: { ...attribs, rel: "noopener noreferrer" } }
          : { tagName, attribs },
    },
  });

  return normalizeDashes(clean);
}

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

/** Slugs of every `/blog/<slug>` link in the article HTML. */
export function internalBlogSlugs(html: string): string[] {
  return Array.from(
    html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g),
    (match) => match[1],
  );
}
