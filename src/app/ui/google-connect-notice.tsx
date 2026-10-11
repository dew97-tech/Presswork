"use client";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

const ERROR_REASONS: Record<string, string> = {
  encryption:
    "SETTINGS_ENCRYPTION_KEY is missing from the environment. Add it before connecting Google.",
  config:
    "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not configured.",
  state:
    "The connection attempt could not be verified because the state check failed. Try connecting again.",
  denied: "Google access was denied. Nothing was changed.",
  exchange:
    "Google did not return usable tokens. Revoke the app access in your Google account and connect again.",
  google: "Google returned an error during authorization.",
};

export default function GoogleConnectNotice({
  status,
  reason,
}: {
  status?: "connected" | "error";
  reason?: string;
}) {
  const { toast } = useToast();
  const fired = useRef(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!status || fired.current) return;
    fired.current = true;

    if (status === "connected") {
      toast({
        variant: "success",
        label: "Google connected",
        title: "Search Console access is ready.",
      });
    } else {
      toast({
        variant: "error",
        label: "Google connection failed",
        title:
          (reason && ERROR_REASONS[reason]) ??
          "The Google connection could not be completed.",
      });
    }

    window.history.replaceState(null, "", window.location.pathname);
  }, [status, reason, toast]);

  if (!status || dismissed) return null;

  const isSuccess = status === "connected";
  const message = isSuccess
    ? "The Google account is linked. Pick a Search Console property below."
    : ((reason && ERROR_REASONS[reason]) ??
      "The Google connection could not be completed.");

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-card px-5 py-4",
        isSuccess ? "border-l-2 border-l-ok" : "border-l-2 border-l-danger",
      )}
    >
      {isSuccess ? (
        <CheckCircle
          size={16}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-ok"
        />
      ) : (
        <WarningCircle
          size={16}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-danger"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="eyebrow text-ink-faint">
          {isSuccess ? "Google connected" : "Google connection"}
        </p>
        <p className="mt-1 text-sm leading-snug text-foreground">{message}</p>
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss Google connection notice"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:text-foreground"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
