"use client";

import DeletePostButton from "@/app/ui/delete-post-button";
import GeneratePostButton from "@/app/ui/generate-post-button";
import { getModel } from "@/app/lib/ai/models";
import { cn } from "@/lib/utils";
import { Eye, MagnifyingGlass, PencilSimple, Plus } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

interface PostItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  published: boolean;
  date: string | Date;
  readTime: string;
  tags: string[];
  thumbnail?: string | null;
  source?: string;
  aiModel?: string | null;
  topic?: string | null;
  keywords?: string[];
}

export default function AdminPostsManager({
  initialPosts,
  maxAutoDrafts,
}: {
  initialPosts: PostItem[];
  maxAutoDrafts: number;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");

  const stats = useMemo(() => {
    return {
      total: initialPosts.length,
      published: initialPosts.filter((p) => p.published).length,
      drafts: initialPosts.filter((p) => !p.published).length,
      aiDrafts: initialPosts.filter((p) => !p.published && p.source === "ai")
        .length,
    };
  }, [initialPosts]);

  const filteredPosts = useMemo(() => {
    return initialPosts.filter((post) => {
      if (statusFilter === "published" && !post.published) return false;
      if (statusFilter === "draft" && post.published) return false;

      if (!query.trim()) return true;

      const q = query.toLowerCase();
      const matchesTitle = post.title.toLowerCase().includes(q);
      const matchesDesc = post.description.toLowerCase().includes(q);
      const matchesTags = post.tags.some((t) => t.toLowerCase().includes(q));

      return matchesTitle || matchesDesc || matchesTags;
    });
  }, [initialPosts, query, statusFilter]);

  const filters = [
    { key: "all" as const, label: `All (${stats.total})` },
    { key: "published" as const, label: `Published (${stats.published})` },
    { key: "draft" as const, label: `Drafts (${stats.drafts})` },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-[-0.01em] text-foreground">
            Articles
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {stats.total} total, {stats.published} published, {stats.drafts}{" "}
            drafts.
          </p>
          <p className="mt-1 text-[13px] text-ink-faint">
            {stats.aiDrafts >= maxAutoDrafts
              ? "Daily generation is paused until an AI draft is published or deleted."
              : `AI draft slots used: ${stats.aiDrafts} of ${maxAutoDrafts}.`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <GeneratePostButton />

          <Link
            href="/admin/new"
            className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98]"
          >
            <Plus size={14} aria-hidden="true" />
            <span>New post</span>
          </Link>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={statusFilter === filter.key}
                className={cn(
                  "text-sm transition-colors",
                  statusFilter === filter.key
                    ? "text-foreground underline decoration-1 underline-offset-4"
                    : "text-ink-muted hover:text-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <label htmlFor="admin-search" className="sr-only">
              Search articles
            </label>
            <input
              id="admin-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, tag, or topic…"
              className="h-11 w-full rounded border border-input bg-surface pl-9 pr-3 text-base text-ink placeholder:text-ink-faint"
            />
            <MagnifyingGlass
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
          </div>
        </div>

        <div className="overflow-x-auto border-t border-border">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[13px] text-ink-muted">
                <th className="px-4 py-3 font-normal">Article</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal">Date</th>
                <th className="px-4 py-3 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredPosts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-14 text-center">
                    <p className="font-medium text-foreground">
                      {query ? `No articles match "${query}".` : "No articles in this view."}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      <Link
                        href="/admin/new"
                        className="underline decoration-1 underline-offset-4 transition-colors hover:text-foreground"
                      >
                        Write a new post
                      </Link>
                      .
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPosts.map((post) => (
                  <tr key={post.id} className="group transition-colors hover:bg-accent/40">
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-4">
                        <div className="relative h-11 w-16 shrink-0 overflow-hidden rounded border border-border bg-muted">
                          {post.thumbnail ? (
                            <Image
                              src={post.thumbnail}
                              alt=""
                              fill
                              className="object-cover"
                              sizes="64px"
                            />
                          ) : null}
                        </div>

                        <div className="min-w-0">
                          <Link
                            href={`/admin/edit/${post.id}`}
                            className="line-clamp-1 text-sm font-medium text-foreground underline-offset-4 group-hover:underline"
                          >
                            {post.title}
                          </Link>
                          <p className="mt-0.5 line-clamp-1 max-w-xl text-[13px] text-ink-muted">
                            {post.description || "No excerpt"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono text-[11px] text-ink-faint">
                              /{post.slug}
                            </span>
                            {post.source === "ai" && (
                              <span
                                className="font-mono text-[11px] text-ink-faint"
                                title={`AI draft${post.aiModel ? ` (${post.aiModel})` : ""}`}
                              >
                                AI
                                {post.aiModel
                                  ? ` (${getModel(post.aiModel)?.label ?? post.aiModel})`
                                  : ""}
                              </span>
                            )}
                            {post.keywords && post.keywords.length > 0 && (
                              <span
                                className="font-mono text-[11px] text-ink-faint"
                                title={`Primary keyword: ${post.keywords[0]}`}
                              >
                                KW: {post.keywords[0]}
                              </span>
                            )}
                            {post.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="blog-tag text-[11px]">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-[13px]">
                      {post.published ? (
                        <span className="text-ok">Published</span>
                      ) : (
                        <span className="text-warn">Draft</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 font-mono text-[13px] tabular-nums text-ink-muted">
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                      <div className="text-[11px] text-ink-faint">{post.readTime}</div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {post.published && (
                          <Link
                            href={`/blog/${post.slug}`}
                            target="_blank"
                            aria-label="View published article"
                            title="View published article"
                            className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent text-ink-muted transition-colors hover:border-border hover:text-foreground"
                          >
                            <Eye size={15} aria-hidden="true" />
                          </Link>
                        )}

                        <Link
                          href={`/admin/edit/${post.id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-sm text-ink-muted transition-colors hover:text-foreground"
                          title="Edit article"
                        >
                          <PencilSimple size={14} aria-hidden="true" />
                          <span>Edit</span>
                        </Link>

                        <DeletePostButton postId={post.id} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
