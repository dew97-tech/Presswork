"use client";

import {
  triggerGeneration,
  type GenerationActionState,
} from "@/app/lib/admin-actions";
import { useToast } from "@/components/ui/toast";
import { CircleNotch, Sparkle } from "@phosphor-icons/react";
import { useActionState, useEffect, useRef } from "react";

export default function GeneratePostButton({
  aiConfigured,
}: {
  aiConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    GenerationActionState | null,
    FormData
  >(triggerGeneration, null);
  const { toast } = useToast();
  const handledState = useRef<GenerationActionState | null>(null);

  useEffect(() => {
    if (!state || state === handledState.current) return;
    handledState.current = state;

    if (state.status === "success") {
      toast({
        variant: "success",
        label: "Draft created",
        title: state.message,
      });
      return;
    }

    if (state.status === "skipped") {
      toast({
        variant: "info",
        label: "Generation paused",
        title: state.message,
      });
      return;
    }

    toast({
      variant: "error",
      label: "Generation failed",
      title: state.message,
      detail: state.detail,
    });
  }, [state, toast]);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending || !aiConfigured}
        title={
          aiConfigured
            ? "Generate an AI draft now, ignoring the draft cap"
            : "AI is paused: no model API key is configured"
        }
        className="inline-flex h-11 items-center gap-1.5 rounded border border-border px-4 text-sm text-ink-muted transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkle size={14} aria-hidden="true" />
        )}
        <span>{pending ? "Generating…" : "Generate now"}</span>
      </button>
    </form>
  );
}
