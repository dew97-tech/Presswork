"use client";

import { saveKeywordPlannerSettings } from "@/app/lib/settings-actions";
import type { KeywordPlannerSettings } from "@/app/lib/settings";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CircleNotch, FloppyDisk } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const inputClassName =
  "h-11 w-full rounded border border-input bg-surface px-3 font-mono text-sm text-foreground";

export default function KeywordPlannerSettingsCard({
  settings,
  developerTokenConfigured,
}: {
  settings: KeywordPlannerSettings;
  developerTokenConfigured: boolean;
}) {
  const { toast } = useToast();
  const router = useRouter();

  const [customerId, setCustomerId] = useState(settings.customerId);
  const [loginCustomerId, setLoginCustomerId] = useState(
    settings.loginCustomerId,
  );
  const [geo, setGeo] = useState(settings.geo);
  const [language, setLanguage] = useState(settings.language);
  const [network, setNetwork] = useState<KeywordPlannerSettings["network"]>(
    settings.network,
  );
  const [isSaving, startSave] = useTransition();

  const handleSave = () => {
    startSave(async () => {
      const result = await saveKeywordPlannerSettings({
        customerId,
        loginCustomerId,
        geo: geo.trim() || "2840",
        language: language.trim() || "1000",
        network,
      });

      if (result.ok) {
        toast({
          variant: "success",
          label: "Planner settings saved",
          title: "The keyword planner will use these targets.",
        });
        router.refresh();
      } else {
        toast({
          variant: "error",
          label: "Save failed",
          title: result.error ?? "Could not save planner settings.",
        });
      }
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Keyword Planner
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Google Ads account and targeting used by the Keywords page. Reads
            keyword ideas with search volume, competition, and bid ranges. The
            developer token stays in the environment.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 rounded-full",
              developerTokenConfigured ? "bg-ok" : "bg-danger",
            )}
          />
          <span
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.08em]",
              developerTokenConfigured ? "text-ok" : "text-danger",
            )}
          >
            {developerTokenConfigured ? "Token set" : "Token missing"}
          </span>
        </div>
      </header>

      {!developerTokenConfigured ? (
        <p className="mt-3 rounded border border-border bg-surface px-3 py-2 text-[13px] text-ink-muted">
          Add{" "}
          <code className="rounded border border-border bg-paper-soft px-1 py-0.5 font-mono text-[12px]">
            GOOGLE_ADS_DEVELOPER_TOKEN
          </code>{" "}
          with Basic access before syncing. Test-account tokens do not return
          real metrics.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="eyebrow text-ink-faint">Customer ID</span>
          <input
            type="text"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            inputMode="numeric"
            placeholder="1234567890"
            spellCheck={false}
            className={cn(inputClassName, "mt-2")}
          />
          <span className="mt-1 block text-[12px] text-ink-faint">
            10 digits, dashes are stripped on save.
          </span>
        </label>

        <label className="block">
          <span className="eyebrow text-ink-faint">
            Login customer ID (MCC, optional)
          </span>
          <input
            type="text"
            value={loginCustomerId}
            onChange={(event) => setLoginCustomerId(event.target.value)}
            inputMode="numeric"
            placeholder="Leave empty for direct access"
            spellCheck={false}
            className={cn(inputClassName, "mt-2")}
          />
          <span className="mt-1 block text-[12px] text-ink-faint">
            Set this when the account sits under a manager account.
          </span>
        </label>

        <label className="block">
          <span className="eyebrow text-ink-faint">Geo target</span>
          <input
            type="text"
            value={geo}
            onChange={(event) => setGeo(event.target.value)}
            placeholder="2840"
            spellCheck={false}
            className={cn(inputClassName, "mt-2")}
          />
          <span className="mt-1 block text-[12px] text-ink-faint">
            2840 is the United States. Any geo target constant ID works.
          </span>
        </label>

        <label className="block">
          <span className="eyebrow text-ink-faint">Language</span>
          <input
            type="text"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            placeholder="1000"
            spellCheck={false}
            className={cn(inputClassName, "mt-2")}
          />
          <span className="mt-1 block text-[12px] text-ink-faint">
            1000 is English.
          </span>
        </label>

        <label className="block">
          <span className="eyebrow text-ink-faint">Network</span>
          <select
            value={network}
            onChange={(event) =>
              setNetwork(event.target.value as KeywordPlannerSettings["network"])
            }
            className={cn(inputClassName, "mt-2")}
          >
            <option value="GOOGLE_SEARCH">Google Search</option>
            <option value="GOOGLE_SEARCH_AND_PARTNERS">
              Google Search and partners
            </option>
          </select>
          <span className="mt-1 block text-[12px] text-ink-faint">
            Partners broadens the metrics to include search partners.
          </span>
        </label>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <FloppyDisk size={14} aria-hidden="true" />
          )}
          <span>Save planner settings</span>
        </button>
      </div>
    </section>
  );
}
