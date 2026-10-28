import prisma from "@/app/lib/prisma";
import { publishedDate } from "@/app/lib/post-dates";
import { getSiteUrl } from "@/app/lib/site";
import { displayTag, isIndexableTagSummary, loadTagSummaries } from "@/app/lib/tags";
import { slugify } from "@/app/lib/slug";
import BlogPagination from "@/app/ui/blog-pagination";
import BlogSearch from "@/app/ui/blog-search";
import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{
    query?: string;
    page?: string;
  }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const query = params?.query?.trim() ?? "";
  const page = Math.max(1, Number(params?.page) || 1);

  const title = query
    ? `Search: ${query}`
    : page > 1
      ? `Blog, page ${page}`
      : "Blog";

  const canonical = query
    ? "/blog"
    : page > 1
      ? `/blog?page=${page}`
      : "/blog";

  return {
    title,
    description:
      "Notes on building web applications: Next.js, Laravel, databases, and the automation around them.",
    alternates: {
      canonical,
    },
    ...(query ? { robots: { index: false, follow: true } } : {}),
  };
}

const POSTS_PER_PAGE = 6;

export default async function BlogPage({
  searchParams,
}: {
  searchParams?: Promise<{
    query?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const query = params?.query || "";
  const currentPage = Math.max(1, Number(params?.page) || 1);

  const tagSummaries = await loadTagSummaries();
  const indexableTagSlugs = new Set(
    tagSummaries
      .filter((summary) => isIndexableTagSummary(summary))
      .map((summary) => summary.slug),
  );
  const matchedTags = query
    ? tagSummaries
        .flatMap((summary) => summary.variants)
        .filter((tag) => tag.toLowerCase().includes(query.toLowerCase()))
    : [];

  const where = {
    published: true,
    ...(query && {
      OR: [
        { title: { contains: query, mode: "insensitive" as const } },
        { description: { contains: query, mode: "insensitive" as const } },
        ...(matchedTags.length > 0
          ? [{ tags: { hasSome: matchedTags } }]
          : []),
      ],
    }),
  };

  const totalPosts = await prisma.post.count({ where });
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);

  const posts = await prisma.post.findMany({
    where,
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }],
    skip: (currentPage - 1) * POSTS_PER_PAGE,
    take: POSTS_PER_PAGE,
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

  const siteUrl = getSiteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${siteUrl}/blog#collection`,
        url: `${siteUrl}/blog`,
        name: "Blog",
        description:
          "Notes on building web applications: Next.js, Laravel, databases, and the automation around them.",
        inLanguage: "en",
        isPartOf: { "@id": `${siteUrl}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${siteUrl}/blog#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: `${siteUrl}/blog`,
          },
        ],
      },
    ],
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-24 pt-16 md:px-8 md:pb-28 md:pt-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <header className="max-w-[54ch]">
        <h1 className="font-serif text-[clamp(2rem,4vw,2.75rem)] leading-tight tracking-[-0.02em] text-ink-brown">
          Blog
        </h1>
        <p className="mt-4 text-ink-muted">
          Notes on building web applications: Next.js, Laravel, databases, and
          the automation around them.
        </p>
      </header>

      <div className="mt-10 max-w-md">
        <Suspense
          fallback={
            <div className="h-10 rounded border border-border bg-muted" />
          }
        >
          <BlogSearch />
        </Suspense>
      </div>

      {posts.length === 0 ? (
        <div className="mt-14 border-t border-border pt-10">
          <p className="font-medium text-ink-brown">
            {query ? `No posts match "${query}".` : "No posts yet."}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {query ? (
              <>
                Try a different term or{" "}
                <Link
                  href="/blog"
                  className="text-clay-text underline decoration-1 decoration-clay underline-offset-4 transition-colors hover:text-ink-brown"
                >
                  clear the search
                </Link>
                .
              </>
            ) : (
              "New posts will appear here."
            )}
          </p>
        </div>
      ) : (
        <div className="mt-14 border-t border-border">
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
                        {publishedDate(post).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
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
                            {post.tags.slice(0, 3).map((tag: string) => {
                              const tagSlug = slugify(tag);
                              return indexableTagSlugs.has(tagSlug) ? (
                                <Link
                                  key={tag}
                                  href={`/blog/tag/${tagSlug}`}
                                  className="blog-tag"
                                  title={tag}
                                >
                                  {displayTag(tag)}
                                </Link>
                              ) : (
                                <span key={tag} className="blog-tag" title={tag}>
                                  {displayTag(tag)}
                                </span>
                              );
                            })}
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

      {totalPages > 1 && (
        <div className="mt-12">
          <Suspense
            fallback={
              <div className="h-9 w-56 animate-pulse rounded border border-border bg-muted" />
            }
          >
            <BlogPagination totalPages={totalPages} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
