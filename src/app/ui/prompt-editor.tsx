"use client";

import {
  restorePromptDefault,
  restorePromptVersion,
  savePrompt,
  type PromptActionResult,
} from "@/app/lib/prompt-actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowCounterClockwise,
  CircleNotch,
  ClockCounterClockwise,
  FloppyDisk,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

interface PromptVersionEntry {
  version: number;
  system: string;
  user: string;
  savedAt: string;
}

interface PromptTemplateShape {
  system: string;
  user: string;
  version: number;
  updatedAt: string;
  history: PromptVersionEntry[];
}

interface PromptEntry {
  key: string;
  label: string;
  description: string;
  variables: string[];
  template: PromptTemplateShape;
}

const VARIABLE_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

function findVariables(text: string): string[] {
  return Array.from(text.matchAll(VARIABLE_PATTERN), (match) => match[1]);
}

function formatTimestamp(value: string): string {
  if (!value) {
    return "Built-in default";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PromptEditor({ prompts }: { prompts: PromptEntry[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [activeKey, setActiveKey] = useState(prompts[0]?.key ?? "");
  const [drafts, setDrafts] = useState<Record<string, { system: string; user: string }>>(
    () =>
      Object.fromEntries(
        prompts.map((prompt) => [
          prompt.key,
          { system: prompt.template.system, user: prompt.template.user },
        ]),
      ),
  );
  const [versions, setVersions] = useState<Record<string, number>>(() =>
    Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt.template.version])),
  );
  const [focusField, setFocusField] = useState<"system" | "user">("user");
  const [isSaving, startSave] = useTransition();
  const [isRestoring, startRestore] = useTransition();
  const systemRef = useRef<HTMLTextAreaElement | null>(null);
  const userRef = useRef<HTMLTextAreaElement | null>(null);

  const active = prompts.find((prompt) => prompt.key === activeKey) ?? prompts[0];

  const allowedVariables = useMemo(
    () => new Set(active?.variables ?? []),
    [active],
  );

  const draft =
    drafts[activeKey] ?? {
      system: active?.template.system ?? "",
      user: active?.template.user ?? "",
    };

  const unknownVariables = useMemo(() => {
    const found = new Set([
      ...findVariables(draft.system),
      ...findVariables(draft.user),
    ]);
    return Array.from(found).filter((variable) => !allowedVariables.has(variable));
  }, [draft.system, draft.user, allowedVariables]);

  if (!active) {
    return null;
  }

  const activeVersion = versions[activeKey] ?? active.template.version;

  const updateDraft = (field: "system" | "user", value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [activeKey]: {
        system: field === "system" ? value : draft.system,
        user: field === "user" ? value : draft.user,
      },
    }));
  };

  const insertVariable = (variable: string) => {
    const field = focusField;
    const element = field === "system" ? systemRef.current : userRef.current;
    const currentValue = field === "system" ? draft.system : draft.user;
    const start = element?.selectionStart ?? currentValue.length;
    const end = element?.selectionEnd ?? currentValue.length;
    const token = `{{${variable}}}`;
    const nextValue = currentValue.slice(0, start) + token + currentValue.slice(end);

    updateDraft(field, nextValue);

    requestAnimationFrame(() => {
      element?.focus();
      const caret = start + token.length;
      element?.setSelectionRange(caret, caret);
    });
  };

  const applyResult = (result: PromptActionResult, successTitle: string) => {
    if (result.ok) {
      setDrafts((prev) => ({
        ...prev,
        [activeKey]: { system: result.system, user: result.user },
      }));
      setVersions((prev) => ({ ...prev, [activeKey]: result.version }));
      router.refresh();
      toast({ variant: "success", label: "Prompt", title: `${successTitle}.` });
    } else {
      toast({
        variant: "error",
        label: "Prompt update failed",
        title: result.error,
      });
    }
  };

  const handleSave = () => {
    if (unknownVariables.length > 0) {
      toast({
        variant: "error",
        label: "Prompt not saved",
        title: `Unknown variables: ${unknownVariables.join(", ")}.`,
      });
      return;
    }

    startSave(async () => {
      const result = await savePrompt(activeKey, {
        system: draft.system,
        user: draft.user,
      });
      applyResult(result, result.ok ? `Version ${result.version} saved` : "");
    });
  };

  const handleRestoreDefault = () => {
    if (
      !window.confirm(
        "Restore the built-in default for this prompt? The current text is kept in history.",
      )
    ) {
      return;
    }

    startRestore(async () => {
      const result = await restorePromptDefault(activeKey);
      applyResult(result, "Built-in default restored");
    });
  };

  const handleRestoreVersion = (version: number) => {
    startRestore(async () => {
      const result = await restorePromptVersion(activeKey, version);
      applyResult(result, `Version ${version} restored`);
    });
  };

  const secondaryButtonClassName =
    "inline-flex h-11 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-6">
      <div
        className="flex items-center gap-5 border-b border-border pb-3"
        role="tablist"
        aria-label="Prompt templates"
      >
        {prompts.map((prompt) => (
          <button
            key={prompt.key}
            type="button"
            role="tab"
            aria-selected={prompt.key === activeKey}
            onClick={() => setActiveKey(prompt.key)}
            className={cn(
              "text-sm transition-colors",
              prompt.key === activeKey
                ? "text-foreground underline decoration-1 underline-offset-4"
                : "text-ink-muted hover:text-foreground",
            )}
          >
            {prompt.label}
          </button>
        ))}
      </div>

      <section
        role="tabpanel"
        aria-label={active.label}
        className="space-y-5 rounded-lg border border-border bg-card p-6"
      >
        <header>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            {active.label}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{active.description}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {activeVersion > 0
              ? `Version ${activeVersion}, saved ${formatTimestamp(active.template.updatedAt)}`
              : "Built-in default"}
          </p>
        </header>

        <div>
          <label
            htmlFor="prompt-system"
            className="block text-sm font-medium text-foreground"
          >
            System prompt
          </label>
          <textarea
            id="prompt-system"
            ref={systemRef}
            value={draft.system}
            spellCheck={false}
            onFocus={() => setFocusField("system")}
            onChange={(event) => updateDraft("system", event.target.value)}
            className="mt-2 min-h-[260px] w-full rounded border border-input bg-surface p-3 font-mono text-[12px] leading-relaxed text-foreground"
          />
        </div>

        <div>
          <label
            htmlFor="prompt-user"
            className="block text-sm font-medium text-foreground"
          >
            User prompt
          </label>
          <textarea
            id="prompt-user"
            ref={userRef}
            value={draft.user}
            spellCheck={false}
            onFocus={() => setFocusField("user")}
            onChange={(event) => updateDraft("user", event.target.value)}
            className="mt-2 min-h-[260px] w-full rounded border border-input bg-surface p-3 font-mono text-[12px] leading-relaxed text-foreground"
          />
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            Variables, click to insert at the cursor
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {active.variables.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => insertVariable(variable)}
                className="blog-tag cursor-pointer"
              >
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
        </div>

        {unknownVariables.length > 0 ? (
          <p role="alert" className="text-[13px] text-danger">
            Unknown variables: {unknownVariables.join(", ")}. Allowed:{" "}
            {active.variables.join(", ")}.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || unknownVariables.length > 0}
            className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <FloppyDisk size={14} aria-hidden="true" />
            )}
            <span>Save prompt</span>
          </button>

          <button
            type="button"
            onClick={handleRestoreDefault}
            disabled={isRestoring}
            className={secondaryButtonClassName}
          >
            <ArrowCounterClockwise size={14} aria-hidden="true" />
            <span>Restore default</span>
          </button>
        </div>

        <details className="group border-t border-border pt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ClockCounterClockwise size={13} aria-hidden="true" />
            <span>History ({active.template.history.length})</span>
          </summary>

          {active.template.history.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-faint">
              No saved versions yet. The first save keeps the current text here.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {active.template.history.map((entry) => (
                <li
                  key={`${entry.version}-${entry.savedAt}`}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="text-[13px] text-ink-muted">
                    {entry.version > 0
                      ? `Version ${entry.version}`
                      : "Built-in default"}
                    <span className="ml-3 font-mono text-[11px] text-ink-faint">
                      {formatTimestamp(entry.savedAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRestoreVersion(entry.version)}
                    disabled={isRestoring}
                    className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </div>
  );
}
