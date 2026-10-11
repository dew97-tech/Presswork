"use client";

import { generateImagePrompt } from "@/app/lib/admin-actions";
import { useToast } from "@/components/ui/toast";
import { Check, CircleNotch, CopySimple, Sparkle } from "@phosphor-icons/react";
import { useState, useTransition } from "react";

export default function ImagePromptPanel({
  title,
  description,
  topic,
  keywords,
  tags,
  content,
}: {
  title: string;
  description: string;
  topic: string;
  keywords: string[];
  tags: string[];
  content: string;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleGenerate = () => {
    setCopied(false);

    startTransition(async () => {
      const state = await generateImagePrompt({
        title,
        description,
        topic,
        keywords,
        tags,
        content,
      });

      if (state.prompt) {
        setPrompt(state.prompt);
        return;
      }

      toast({
        variant: "error",
        label: "Prompt generation failed",
        title: state.message ?? "Could not generate a prompt.",
      });
    });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    toast({
      variant: "success",
      label: "Copied",
      title: "Prompt copied to the clipboard.",
    });
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          Generate a prompt for the cover image, then paste it into an image
          model such as GPT or Gemini.
        </p>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={pending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkle size={14} aria-hidden="true" />
          )}
          <span>
            {pending ? "Generating…" : prompt ? "Regenerate" : "Generate prompt"}
          </span>
        </button>
      </div>

      {prompt ? (
        <div className="space-y-3 rounded border border-border bg-surface p-3">
          <p className="font-mono text-[12px] leading-relaxed text-ink-muted">
            {prompt}
          </p>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-[13px] text-ink-muted transition-colors hover:text-foreground"
          >
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <CopySimple size={14} aria-hidden="true" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
