"use client";

import { cn } from "@/lib/utils";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

export interface PropertyOption {
  siteUrl: string;
  permissionLevel: string;
}

function permissionLabel(level: string): string {
  const normalized = level.trim();
  return normalized.length > 0 ? normalized : "unknown access";
}

export default function PropertyPicker({
  value,
  onChange,
  options,
  savedValue,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PropertyOption[];
  savedValue: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rawActiveIndex, setRawActiveIndex] = useState(0);

  const query = value.trim().toLowerCase();
  const filtered =
    query.length === 0
      ? options
      : options.filter((option) =>
          option.siteUrl.toLowerCase().includes(query),
        );

  const activeIndex = Math.min(
    rawActiveIndex,
    Math.max(filtered.length - 1, 0),
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open ]);

  const choose = (siteUrl: string) => {
    onChange(siteUrl);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setRawActiveIndex(
        (prev) => (prev + step + filtered.length) % filtered.length,
      );
      return;
    }

    if (event.key === "Enter") {
      const match = filtered[activeIndex];
      if (open && match) {
        event.preventDefault();
        choose(match.siteUrl);
      }
      return;
    }

    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (event.key === "Home" && open && filtered.length > 0) {
      event.preventDefault();
      setRawActiveIndex(0);
      return;
    }

    if (event.key === "End" && open && filtered.length > 0) {
      event.preventDefault();
      setRawActiveIndex(filtered.length - 1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full md:max-w-md">
      <div className="relative">
        <input
          ref={inputRef}
          id="gsc-property"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && filtered[activeIndex]
              ? `${listId}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setRawActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            if (options.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder="sc-domain:davidmallick.dev"
          className="h-11 w-full rounded border border-input bg-surface py-2 pl-3 pr-11 font-mono text-sm text-foreground placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => {
            if (!disabled) {
              setOpen((current) => !current);
              inputRef.current?.focus();
            }
          }}
          disabled={disabled}
          aria-label={open ? "Close property list" : "Open property list"}
          aria-expanded={open}
          className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CaretDown
            size={14}
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Search Console properties"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded border border-border bg-surface"
        >
          {options.length === 0 ? (
            <p className="px-3 py-4 text-[13px] leading-relaxed text-ink-muted">
              No properties loaded yet. Use Load properties to list this
              account&apos;s properties, or type one manually.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ink-muted">
              No loaded properties match. Press Enter to keep the typed value.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((option, index) => {
                const isActive = index === activeIndex;
                const isSaved =
                  savedValue.length > 0 && option.siteUrl === savedValue;
                return (
                  <li
                    key={option.siteUrl}
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option.siteUrl);
                    }}
                    onMouseEnter={() => setRawActiveIndex(index)}
                    className={cn(
                      "flex cursor-pointer items-start justify-between gap-3 px-3 py-2.5 transition-colors",
                      isActive ? "bg-accent" : "bg-surface",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[13px] text-foreground">
                        {option.siteUrl}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1.5">
                        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                          {permissionLabel(option.permissionLevel)}
                        </span>
                        {isSaved ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ok">
                            <Check size={11} weight="bold" aria-hidden="true" />
                            saved
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {isActive ? (
                      <Check
                        size={14}
                        weight="bold"
                        aria-hidden="true"
                        className="mt-1 shrink-0 text-ink-faint"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
