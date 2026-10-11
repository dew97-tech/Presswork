"use client";

import {
  priceLabel,
  REASONING_EFFORTS,
  type GoModel,
  type GoTier,
  type ReasoningEffort,
} from "@/app/lib/ai/models";
import {
  refreshModelCatalog,
  saveAiSettings,
  testModel,
} from "@/app/lib/settings-actions";
import type {
  AnalysisSettings,
  GenerationSettings,
  ImageSettings,
  ReviewSettings,
} from "@/app/lib/settings";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  CircleNotch,
  FloppyDisk,
  Lightning,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { useMemo, useState, useTransition, type ReactNode } from "react";

interface Selection {
  modelId: string;
  reasoningEffort: ReasoningEffort;
}

const TIER_ORDER: GoTier[] = ["free", "cheap", "standard"];

const TIER_LABELS: Record<GoTier, string> = {
  free: "Free",
  cheap: "Cheap",
  standard: "Standard",
};

const selectClassName =
  "h-11 w-full rounded border border-input bg-surface px-3 text-sm text-foreground";

function ModelSelect({
  id,
  value,
  onChange,
  models,
  disabledIds,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (modelId: string) => void;
  models: GoModel[];
  disabledIds?: Set<string>;
  ariaLabel: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={selectClassName}
    >
      {TIER_ORDER.map((tier) => {
        const tierModels = models.filter((model) => model.tier === tier);
        if (tierModels.length === 0) {
          return null;
        }

        return (
          <optgroup key={tier} label={TIER_LABELS[tier]}>
            {tierModels.map((model) => (
              <option
                key={model.id}
                value={model.id}
                disabled={disabledIds?.has(model.id) && model.id !== value}
              >
                {model.label} ({priceLabel(model)})
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function ReasoningSelect({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as ReasoningEffort)}
      aria-label={ariaLabel}
      className={cn(selectClassName, "w-32", className)}
    >
      {REASONING_EFFORTS.map((effort) => (
        <option key={effort} value={effort}>
          {effort}
        </option>
      ))}
    </select>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 items-center justify-center rounded border border-border text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export default function AiModelSettings({
  models,
  generation,
  review,
  image,
  analysis,
  apiKeyConfigured,
}: {
  models: GoModel[];
  generation: GenerationSettings;
  review: ReviewSettings;
  image: ImageSettings;
  analysis: AnalysisSettings;
  apiKeyConfigured: boolean;
}) {
  const { toast } = useToast();
  const [chain, setChain] = useState<Selection[]>(generation.chain);
  const [reviewSelection, setReviewSelection] = useState<Selection>({
    modelId: review.modelId,
    reasoningEffort: review.reasoningEffort,
  });
  const [webSearch, setWebSearch] = useState(review.webSearch);
  const [imageSelection, setImageSelection] = useState<Selection>({
    modelId: image.modelId,
    reasoningEffort: image.reasoningEffort,
  });
  const [analysisSelection, setAnalysisSelection] = useState<Selection>({
    modelId: analysis.modelId,
    reasoningEffort: analysis.reasoningEffort,
  });
  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  const chainIds = useMemo(
    () => new Set(chain.map((entry) => entry.modelId)),
    [chain],
  );

  const reviewModel = modelById.get(reviewSelection.modelId);
  const imageModel = modelById.get(imageSelection.modelId);
  const analysisModel = modelById.get(analysisSelection.modelId);

  const updateEntry = (index: number, update: Partial<Selection>) => {
    setChain((prev) =>
      prev.map((entry, i) => {
        if (i !== index) {
          return entry;
        }

        const next = { ...entry, ...update };
        const model = modelById.get(next.modelId);
        if (model && !model.reasoning) {
          next.reasoningEffort = "none";
        }
        return next;
      }),
    );
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    setChain((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) {
        return prev;
      }

      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeEntry = (index: number) => {
    setChain((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const addEntry = () => {
    if (chain.length >= models.length) {
      return;
    }

    const used = new Set(chain.map((entry) => entry.modelId));
    const candidate =
      models.find((model) => model.tier === "cheap" && !used.has(model.id)) ??
      models.find((model) => !used.has(model.id));
    if (!candidate) {
      return;
    }

    setChain((prev) => [
      ...prev,
      { modelId: candidate.id, reasoningEffort: "none" },
    ]);
  };

  const handleSave = () => {
    startSave(async () => {
      const result = await saveAiSettings({
        generation: {
          chain: chain.map((entry) => ({
            modelId: entry.modelId,
            reasoningEffort: "none" as const,
          })),
        },
        review: {
          modelId: reviewSelection.modelId,
          reasoningEffort: reviewSelection.reasoningEffort,
          webSearch,
        },
        image: imageSelection,
        analysis: {
          modelId: analysisSelection.modelId,
          reasoningEffort: analysisSelection.reasoningEffort,
        },
      });

      if (result.ok) {
        toast({
          variant: "success",
          label: "Settings saved",
          title: "AI model settings updated.",
        });
      } else {
        toast({
          variant: "error",
          label: "Save failed",
          title: result.error ?? "Could not save settings.",
        });
      }
    });
  };

  const handleTest = () => {
    const first = chain[0];
    if (!first) {
      return;
    }

    startTest(async () => {
      const result = await testModel(first.modelId);
      if (result.ok) {
        const label = modelById.get(first.modelId)?.label ?? first.modelId;
        toast({
          variant: "success",
          label: "Model responded",
          title: `${label} replied in ${result.latencyMs} ms.`,
        });
      } else {
        toast({
          variant: "error",
          label: "Model test failed",
          title: result.error,
        });
      }
    });
  };

  const handleRefresh = () => {
    startRefresh(async () => {
      const result = await refreshModelCatalog();
      if (!result.ok) {
        toast({
          variant: "error",
          label: "Catalog refresh failed",
          title: result.error,
        });
        return;
      }

      const parts = [`${result.count} models available at the gateway.`];
      if (result.missing.length > 0) {
        parts.push(`Not in catalog: ${result.missing.join(", ")}.`);
      }
      if (result.stale.length > 0) {
        parts.push(`No longer available: ${result.stale.join(", ")}.`);
      }

      toast({ variant: "info", label: "Model catalog", title: parts.join(" ") });
    });
  };

  const secondaryButtonClassName =
    "inline-flex h-11 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 rounded-full",
                apiKeyConfigured ? "bg-ok" : "bg-danger",
              )}
            />
            <span className="text-sm font-medium text-foreground">
              OpenCode Go connection
            </span>
          </div>
          <span
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.08em]",
              apiKeyConfigured ? "text-ok" : "text-danger",
            )}
          >
            {apiKeyConfigured ? "Connected" : "Not configured"}
          </span>
        </div>
        {!apiKeyConfigured ? (
          <p className="mt-2 text-[13px] text-ink-muted">
            Add the{" "}
            <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[12px]">
              OPENCODE_GO_API_KEY
            </code>{" "}
            environment variable to enable generation, review, and image
            prompts.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <header>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Generation chain
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Models are tried in order until one returns a draft that passes
            validation. Generation always runs without reasoning so the full
            output budget goes to the article. Reasoning is used for review and
            image prompts.
          </p>
        </header>

        <ul className="mt-4">
          {chain.map((entry, index) => (
            <li
              key={entry.modelId}
              className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 md:flex-row md:items-center"
            >
              <div className="min-w-0 flex-1">
                <ModelSelect
                  id={`chain-model-${index}`}
                  value={entry.modelId}
                  onChange={(modelId) => updateEntry(index, { modelId })}
                  models={models}
                  disabledIds={chainIds}
                  ariaLabel={`Generation model ${index + 1}`}
                />
              </div>

              <div className="flex items-center gap-2">
                <span
                  className="px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint"
                  title="Generation runs without reasoning; the full output budget goes to the article."
                >
                  No reasoning
                </span>

                <IconButton
                  label="Move up"
                  onClick={() => moveEntry(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Move down"
                  onClick={() => moveEntry(index, 1)}
                  disabled={index === chain.length - 1}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Remove model"
                  onClick={() => removeEntry(index)}
                  disabled={chain.length <= 1}
                >
                  <Trash size={14} aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={addEntry}
            disabled={chain.length >= models.length}
            className={secondaryButtonClassName}
          >
            <Plus size={14} aria-hidden="true" />
            <span>Add fallback model</span>
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting}
            className={secondaryButtonClassName}
          >
            {isTesting ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Lightning size={14} aria-hidden="true" />
            )}
            <span>Test first model</span>
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <header>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Review model
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Reviews articles for accuracy and SEO, and can verify claims with
            web search.
          </p>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <ModelSelect
            value={reviewSelection.modelId}
            onChange={(modelId) =>
              setReviewSelection((prev) => {
                const model = modelById.get(modelId);
                return {
                  modelId,
                  reasoningEffort:
                    model && !model.reasoning ? "none" : prev.reasoningEffort,
                };
              })
            }
            models={models}
            ariaLabel="Review model"
          />

          {reviewModel?.reasoning ? (
            <ReasoningSelect
              value={reviewSelection.reasoningEffort}
              onChange={(reasoningEffort) =>
                setReviewSelection((prev) => ({ ...prev, reasoningEffort }))
              }
              ariaLabel="Review reasoning effort"
            />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-foreground">
            Web search verification
          </span>
          <div
            className="flex rounded border border-border"
            role="group"
            aria-label="Web search verification"
          >
            {(["On", "Off"] as const).map((label, index) => {
              const value = label === "On";
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setWebSearch(value)}
                  aria-pressed={webSearch === value}
                  className={cn(
                    "px-3 py-1.5 text-[13px] transition-colors",
                    index === 0 ? "rounded-l" : "rounded-r",
                    webSearch === value
                      ? "bg-accent text-foreground"
                      : "text-ink-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <header>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Analysis model
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Runs the Search Console SEO analysis from the dashboard. Defaults
            to DeepSeek V4.1 Flash without reasoning.
          </p>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <ModelSelect
            value={analysisSelection.modelId}
            onChange={(modelId) =>
              setAnalysisSelection((prev) => {
                const model = modelById.get(modelId);
                return {
                  modelId,
                  reasoningEffort:
                    model && !model.reasoning ? "none" : prev.reasoningEffort,
                };
              })
            }
            models={models}
            ariaLabel="Analysis model"
          />

          {analysisModel?.reasoning ? (
            <ReasoningSelect
              value={analysisSelection.reasoningEffort}
              onChange={(reasoningEffort) =>
                setAnalysisSelection((prev) => ({ ...prev, reasoningEffort }))
              }
              ariaLabel="Analysis reasoning effort"
            />
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <header>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Image prompt model
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Writes the cover image prompt from a finished article.
          </p>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <ModelSelect
            value={imageSelection.modelId}
            onChange={(modelId) =>
              setImageSelection((prev) => {
                const model = modelById.get(modelId);
                return {
                  modelId,
                  reasoningEffort:
                    model && !model.reasoning ? "none" : prev.reasoningEffort,
                };
              })
            }
            models={models}
            ariaLabel="Image prompt model"
          />

          {imageModel?.reasoning ? (
            <ReasoningSelect
              value={imageSelection.reasoningEffort}
              onChange={(reasoningEffort) =>
                setImageSelection((prev) => ({ ...prev, reasoningEffort }))
              }
              ariaLabel="Image prompt reasoning effort"
            />
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
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
          <span>Save settings</span>
        </button>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={secondaryButtonClassName}
        >
          {isRefreshing ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <ArrowsClockwise size={14} aria-hidden="true" />
          )}
          <span>Refresh model catalog</span>
        </button>
      </div>
    </div>
  );
}
