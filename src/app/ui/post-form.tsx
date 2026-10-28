"use client";

import { createPost, updatePost } from "@/app/lib/admin-actions";
import { discardUploadedBlob } from "@/app/lib/blob-actions";
import { useToast } from "@/components/ui/toast";
import { upload } from "@vercel/blob/client";
import {
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  ImageSquare,
  Tag,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import ImagePromptPanel from "./image-prompt-panel";
import TiptapEditor from "./tiptap-editor";

interface EditablePost {
  id: string;
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  content?: string | null;
  published?: boolean | null;
  readTime?: string | null;
  tags?: string[] | null;
  topic?: string | null;
  keywords?: string[] | null;
}

interface SaveState {
  message?: string;
  errors?: Record<string, string[] | undefined>;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 90_000;
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const ALLOWED_THUMBNAIL_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const ALLOWED_THUMBNAIL_HOSTS = new Set(["images.unsplash.com"]);

function isAllowedThumbnailUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/")) return true;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return false;

    return (
      parsed.hostname.endsWith(ALLOWED_THUMBNAIL_HOST_SUFFIX) ||
      ALLOWED_THUMBNAIL_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export default function PostForm({ post }: { post?: EditablePost }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(post?.title || "");
  const [slug, setSlug] = useState(post?.slug || "");
  const [description, setDescription] = useState(post?.description || "");
  const [thumbnailUrl, setThumbnailUrl] = useState(post?.thumbnail || "");
  const [content, setContent] = useState(post?.content || "");
  const [isPublished, setIsPublished] = useState(post?.published ?? false);
  const [readTime, setReadTime] = useState(post?.readTime || "5 min read");
  const [tags, setTags] = useState<string[]>(
    post?.tags || ["Engineering", "Web Development"],
  );
  const [tagInput, setTagInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [urlWarning, setUrlWarning] = useState(false);
  const inputFileRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    if (!post) {
      setSlug(generateSlug(val));
    }
  };

  const handleContentChange = (newHtml: string) => {
    setContent(newHtml);
    const textOnly = newHtml.replace(/<[^>]*>/g, " ");
    const words = textOnly.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 200));
    setReadTime(`${minutes} min read`);
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!event.target.files || event.target.files.length === 0) return;

    const file = event.target.files[0];

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast({
        variant: "error",
        label: "Unsupported file",
        title: "Use a JPEG, PNG, GIF, or WebP image.",
      });
      event.target.value = "";
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        variant: "error",
        label: "File too large",
        title: `Images must be under 10 MB. This one is ${(file.size / (1024 * 1024)).toFixed(1)} MB.`,
      });
      event.target.value = "";
      return;
    }

    const previousUrl = thumbnailUrl;
    const controller = new AbortController();
    const abortState = { reason: "cancel" as "cancel" | "timeout" };
    const watchdog = window.setTimeout(() => {
      abortState.reason = "timeout";
      controller.abort();
    }, UPLOAD_TIMEOUT_MS);

    setIsUploading(true);
    setUploadProgress(0);
    uploadAbortRef.current = controller;

    try {
      const newBlob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          setUploadProgress(Math.min(99, Math.round(percentage)));
        },
      });
      setThumbnailUrl(newBlob.url);
      if (previousUrl && previousUrl !== newBlob.url) {
        discardUploadedBlob(previousUrl).catch(() => undefined);
      }
      toast({
        variant: "success",
        label: "Uploaded",
        title: "Cover image uploaded.",
      });
    } catch (error) {
      console.error("Upload failed:", error);

      if (controller.signal.aborted) {
        if (abortState.reason === "timeout") {
          toast({
            variant: "error",
            label: "Upload timed out",
            title:
              "The upload did not finish within 90 seconds. Check your connection and try again.",
          });
        } else {
          toast({
            variant: "info",
            label: "Cancelled",
            title: "Cover image upload cancelled.",
          });
        }
      } else {
        const raw = error instanceof Error ? error.message : "Upload failed";
        const message = /access denied|valid token/i.test(raw)
          ? "The Blob store rejected the upload token. Ask the site owner to rotate BLOB_READ_WRITE_TOKEN"
          : raw;
        toast({
          variant: "error",
          label: "Upload failed",
          title: `${message}. Paste an image URL instead.`,
        });
      }
    } finally {
      window.clearTimeout(watchdog);
      uploadAbortRef.current = null;
      setIsUploading(false);
      setUploadProgress(null);
      event.target.value = "";
    }
  };

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const handleRemoveThumbnail = () => {
    const removedUrl = thumbnailUrl;
    setThumbnailUrl("");
    setUrlWarning(false);
    if (removedUrl) {
      discardUploadedBlob(removedUrl).catch(() => undefined);
    }
  };

  const handleThumbnailUrlChange = (value: string) => {
    setThumbnailUrl(value);
    setUrlWarning(
      value.trim().length > 0 && !isAllowedThumbnailUrl(value),
    );
  };

  const [saveState, saveFormAction] = useActionState<SaveState | null, FormData>(
    async (_prev, formData) => {
      formData.set("title", title);
      formData.set("slug", slug);
      formData.set("description", description);
      formData.set("thumbnail", thumbnailUrl);
      formData.set("content", content);
      formData.set("published", isPublished ? "true" : "false");
      formData.set("readTime", readTime);
      formData.set("tags", tags.join(", "));

      const result = post
        ? await updatePost(post.id, _prev, formData)
        : await createPost(_prev, formData);

      if (result?.message) {
        toast({
          variant: "error",
          label: "Save failed",
          title: result.message,
        });
      }

      return result ?? null;
    },
    null,
  );

  const fieldLabel = "block text-sm font-medium text-foreground";

  return (
    <form action={saveFormAction} className="space-y-8">
      <h1 className="font-serif text-2xl tracking-[-0.01em] text-foreground">
        {post ? "Edit post" : "New post"}
      </h1>

      <input type="hidden" name="published" value={isPublished ? "true" : "false"} />
      <input type="hidden" name="thumbnail" value={thumbnailUrl} />
      <input type="hidden" name="readTime" value={readTime} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">
          <div className="space-y-5 rounded-lg border border-border bg-card p-6">
            <div className="space-y-2">
              <label htmlFor="title" className={fieldLabel}>
                Title
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={title}
                onChange={handleTitleChange}
                required
                placeholder="What the post is about"
                className="w-full border-b border-input bg-transparent pb-2 font-serif text-2xl text-foreground outline-none placeholder:text-ink-faint md:text-3xl"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="slug" className={fieldLabel}>
                  URL
                </label>
                <div className="flex items-center gap-1 rounded border border-input bg-surface px-3 py-2 text-sm">
                  <span className="font-mono text-[13px] text-ink-faint">
                    /blog/
                  </span>
                  <input
                    type="text"
                    id="slug"
                    name="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    required
                    spellCheck={false}
                    className="flex-1 border-none bg-transparent font-mono text-[13px] text-foreground outline-none"
                  />
                </div>
                {saveState?.errors?.slug?.length ? (
                  <p className="text-[13px] text-destructive">
                    {saveState.errors.slug[0]}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="readTime" className={fieldLabel}>
                  Read time
                </label>
                <input
                  type="text"
                  id="readTime"
                  name="readTime"
                  value={readTime}
                  onChange={(e) => setReadTime(e.target.value)}
                  className="h-[38px] w-full rounded border border-input bg-surface px-3 text-sm text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className={fieldLabel}>
                Excerpt
              </label>
              <textarea
                id="description"
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={2}
                placeholder="One or two sentences for previews and search results"
                className="w-full resize-none rounded border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-ink-faint"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label className={fieldLabel}>Content</label>
              <span className="text-[13px] text-ink-faint">
                Toolbar shortcuts and HTML paste both work
              </span>
            </div>
            <TiptapEditor content={content} onChange={handleContentChange} />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-medium text-foreground">Publishing</h2>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-ink-muted">
                {isPublished ? "Visible on the public blog." : "Only visible here."}
              </p>
              <div className="flex rounded border border-border" role="group" aria-label="Publish status">
                <button
                  type="button"
                  onClick={() => setIsPublished(false)}
                  aria-pressed={!isPublished}
                  className={`px-2.5 py-1 text-[13px] transition-colors ${
                    !isPublished
                      ? "rounded-l bg-accent text-foreground"
                      : "rounded-l text-ink-muted hover:text-foreground"
                  }`}
                >
                  Draft
                </button>
                <button
                  type="button"
                  onClick={() => setIsPublished(true)}
                  aria-pressed={isPublished}
                  className={`px-2.5 py-1 text-[13px] transition-colors ${
                    isPublished
                      ? "rounded-r bg-accent text-foreground"
                      : "rounded-r text-ink-muted hover:text-foreground"
                  }`}
                >
                  Publish
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              {saveState?.message ? (
                <p
                  role="alert"
                  className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] leading-relaxed text-destructive"
                >
                  {saveState.message}
                </p>
              ) : null}
              <SubmitButton isPublished={isPublished} />
              {post?.slug && (
                <a
                  href={`/blog/${post.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-border px-4 py-2 text-sm text-ink-muted transition-colors hover:text-foreground"
                >
                  <ArrowSquareOut size={14} aria-hidden="true" />
                  <span>View live post</span>
                </a>
              )}
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-medium text-foreground">Cover image</h2>

            {thumbnailUrl ? (
              <div className="space-y-3">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl}
                    alt="Cover preview"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveThumbnail}
                    aria-label="Remove image"
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-ink-muted transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
                <label htmlFor="cover-url" className="sr-only">
                  Cover image URL
                </label>
                <input
                  id="cover-url"
                  type="text"
                  value={thumbnailUrl}
                  onChange={(e) => handleThumbnailUrlChange(e.target.value)}
                  placeholder="Image URL"
                  spellCheck={false}
                  className="w-full rounded border border-input bg-surface px-3 py-1.5 font-mono text-[13px] text-ink-muted"
                />
                {urlWarning ? (
                  <p className="text-[12px] leading-relaxed text-warn">
                    This host is not allowed for blog images, so the cover may
                    not display. Upload the file instead, or paste a Blob store
                    or Unsplash URL.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded border border-dashed border-border p-6 text-center">
                  <ImageSquare
                    size={22}
                    aria-hidden="true"
                    className="mx-auto text-ink-faint"
                  />
                  {isUploading ? (
                    <div className="mt-3 space-y-2" aria-live="polite">
                      <p className="inline-flex items-center justify-center gap-1.5 text-[13px] text-ink-muted">
                        <CircleNotch
                          size={14}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                        <span>Uploading… {uploadProgress ?? 0}%</span>
                      </p>
                      <div
                        role="progressbar"
                        aria-label="Cover image upload progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadProgress ?? 0}
                        className="h-1 w-full overflow-hidden rounded bg-accent"
                      >
                        <div
                          className="h-full rounded bg-primary transition-[width] duration-150"
                          style={{ width: `${uploadProgress ?? 0}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleCancelUpload}
                        className="text-[13px] text-ink-muted transition-colors hover:text-destructive"
                      >
                        Cancel upload
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 text-[13px] text-ink-muted">
                        Upload a file or paste a URL
                      </p>
                      <label
                        htmlFor="thumbnail-upload"
                        className="mt-3 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground"
                      >
                        <UploadSimple size={14} aria-hidden="true" />
                        <span>Upload image</span>
                      </label>
                    </>
                  )}
                  <input
                    id="thumbnail-upload"
                    type="file"
                    ref={inputFileRef}
                    onChange={handleImageUpload}
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="sr-only"
                  />
                </div>
                <label htmlFor="cover-url-new" className="sr-only">
                  Cover image URL
                </label>
                <input
                  id="cover-url-new"
                  type="text"
                  value={thumbnailUrl}
                  onChange={(e) => handleThumbnailUrlChange(e.target.value)}
                  placeholder="Image URL"
                  spellCheck={false}
                  disabled={isUploading}
                  className="w-full rounded border border-input bg-surface px-3 py-1.5 font-mono text-[13px] text-ink-muted disabled:opacity-50"
                />
                {urlWarning ? (
                  <p className="text-[12px] leading-relaxed text-warn">
                    This host is not allowed for blog images, so the cover may
                    not display. Upload the file instead, or paste a Blob store
                    or Unsplash URL.
                  </p>
                ) : null}
              </div>
            )}

            <ImagePromptPanel
              title={title}
              description={description}
              topic={post?.topic ?? ""}
              keywords={post?.keywords ?? []}
              tags={tags}
              content={content}
            />
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Tag size={14} aria-hidden="true" />
              Tags
            </h2>

            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="blog-tag gap-1">
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="text-ink-faint transition-colors hover:text-destructive"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <label htmlFor="tag-input" className="sr-only">
                Add a tag
              </label>
              <input
                id="tag-input"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add a tag"
                className="flex-1 rounded border border-input bg-surface px-3 py-1.5 text-[13px] text-foreground placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="inline-flex h-[30px] items-center rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function SubmitButton({ isPublished }: { isPublished: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
    >
      {pending ? (
        <>
          <CircleNotch size={15} className="animate-spin" aria-hidden="true" />
          <span>Saving…</span>
        </>
      ) : (
        <>
          <CheckCircle size={15} aria-hidden="true" />
          <span>{isPublished ? "Publish" : "Save draft"}</span>
        </>
      )}
    </button>
  );
}
