import prisma from "@/app/lib/prisma";
import { publishedDate } from "@/app/lib/post-dates";
import { getSiteUrl } from "@/app/lib/site";
import { getTagSummaries, loadTagSummaries, displayTag, MIN_INDEXABLE_POSTS, isIndexableTagSummary } from "@/app/lib/tags";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

export const revalidate = 3600;

export async function generateStaticParams() {
  const summaries = await loadTagSummaries();
  return summaries
    .filter((summary) => isIndexableTagSummary(summary))
    .map((summary) => ({ tag: summary.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const summary = (await getTagSummaries()).find((entry) => entry.slug === tag);

  if (!summary) {
    return { title: "Topic not found" };
  }

  const title = `Posts about ${displayTag(summary.tag)}`;
  const description = `Articles about ${displayTag(summary.tag)} on David Dew Mallick's engineering blog: Laravel, PHP, Next.js, databases, and the systems around them.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/blog/tag/${summary.slug}`,
    },
    ...(summary.count < MIN_INDEXABLE_POSTS
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function BlogTagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const summaries = await getTagSummaries();
  const summary = summaries.find((entry) => entry.slug === tag);

  if (!summary) {
    notFound();
  }

  const posts = await prisma.post.findMany({
    where: {
      published: true,
      tags: { hasSome: summary.variants },
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      date: true,
      publishedAt: true,
      readTime: true,
      tags: true,
      thumbnail: true,
    },
  });

  const relatedTopics = summaries
    .filter((entry) => entry.slug !== summary.slug && isIndexableTagSummary(entry))
    .slice(0, 5);

  const siteUrl = getSiteUrl();
  const tagUrl = `${siteUrl}/blog/tag/${summary.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${tagUrl}#collection`,
        url: tagUrl,
        name: `Posts about ${summary.tag}`,
        description: `Articles about ${summary.tag} on David Dew Mallick's engineering blog.`,
        inLanguage: "en",
        isPartOf: { "@id": `${siteUrl}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${tagUrl}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: `${siteUrl}/blog`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: summary.tag,
            item: tagUrl,
          },
        ],
      },
    ],
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-24 pt-10 md:px-8 md:pt-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <Link
        href="/blog"
        className="link-draw font-mono text-sm text-clay-text hover:text-ink-brown"
      >
        Back to blog
      </Link>

      <header className="mt-10 max-w-[54ch] border-b border-border pb-10">
        <p className="eyebrow tabular-nums text-ink-faint">
          Topic · {summary.count} {summary.count === 1 ? "post" : "posts"}
        </p>
        <h1
          className="mt-4 font-serif text-[clamp(1.75rem,4vw,2.75rem)] leading-tight tracking-[-0.02em] text-ink-brown"
          title={summary.tag}
        >
          {displayTag(summary.tag)}
        </h1>
      </header>

      {posts.length === 0 ? (
        <p className="mt-14 border-t border-border pt-10 text-ink-muted">
          No posts on this topic yet.
        </p>
      ) : (
        <div className="mt-6">
          {posts.map((post) => (
            <article key={post.slug} className="border-b border-border">
              <Link
                href={`/blog/${post.slug}`}
                className="group block py-8 md:py-10"
              >
                <div className="grid gap-4 md:grid-cols-12 md:gap-8">
                  <div className="md:col-span-3">
                    <p className="font-mono text-sm tabular-nums text-ink-faint">
                      <time dateTime={publishedDate(post).toISOString()}>
                        {formatDate(publishedDate(post))}
                      </time>
                    </p>
                    <p className="mt-1 font-mono text-sm text-ink-faint">
                      {post.readTime}
                    </p>
                  </div>

                  <div className="md:col-span-9">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h2 className="text-xl font-semibold text-ink-brown underline-offset-4 group-hover:underline">
                          {post.title}
                        </h2>
                        <p className="mt-2 max-w-[62ch] text-base leading-relaxed text-ink-muted line-clamp-2">
                          {post.description}
                        </p>
                        {post.tags.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {post.tags.slice(0, 3).map((postTag: string) => (
                              <span
                                key={postTag}
                                className="blog-tag"
                                title={postTag}
                              >
                                {displayTag(postTag)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {post.thumbnail && (
                        <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded border border-border bg-muted">
                          <Image
                            src={post.thumbnail}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="160px"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}

      {relatedTopics.length > 0 && (
        <div className="mt-12 flex flex-wrap items-center gap-2">
          <span className="eyebrow text-ink-faint">Related topics</span>
          {relatedTopics.map((entry) => (
            <Link
              key={entry.slug}
              href={`/blog/tag/${entry.slug}`}
              className="blog-tag"
              title={entry.tag}
            >
              {displayTag(entry.tag)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
