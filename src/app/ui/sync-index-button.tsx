"use client";

import { syncIndexStatus } from "@/app/lib/google/gsc-actions";
import { useToast } from "@/components/ui/toast";
import { ArrowsClockwise, CircleNotch } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function SyncIndexButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [isSyncing, startSync] = useTransition();

  const handleSync = () => {
    startSync(async () => {
      const result = await syncIndexStatus();

      if (!result.ok) {
        toast({
          variant: "error",
          label: "Index sync failed",
          title: result.error ?? "Could not sync index status.",
        });
        return;
      }

      const checked = result.checked ?? 0;
      const indexed = result.indexed ?? 0;
      const errors = result.errors ?? [];
      const suffix = result.incomplete
        ? " The time budget ran out; click again to continue."
        : "";

      toast({
        variant: result.incomplete
          ? "info"
          : errors.length > 0
            ? "info"
            : "success",
        label: "Index sync",
        title: `${indexed} of ${checked} checked posts report as indexed.${suffix}`,
        detail: errors.length > 0 ? errors.join("\n") : undefined,
      });

      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={isSyncing}
      className="inline-flex h-11 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isSyncing ? (
        <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
      ) : (
        <ArrowsClockwise size={14} aria-hidden="true" />
      )}
      <span>{isSyncing ? "Syncing..." : "Sync index status"}</span>
    </button>
  );
}
