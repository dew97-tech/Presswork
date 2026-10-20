"use client";

import { importPerformanceExports } from "@/app/lib/google/export-actions";
import { useToast } from "@/components/ui/toast";
import { CircleNotch, UploadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

export default function PerformanceImportPanel({
  importedAt,
  pageCount,
  queryCount,
}: {
  importedAt: string | null;
  pageCount: number;
  queryCount: number;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pagesCsv, setPagesCsv] = useState("");
  const [queriesCsv, setQueriesCsv] = useState("");
  const [pagesName, setPagesName] = useState("");
  const [queriesName, setQueriesName] = useState("");
  const [isImporting, startImport] = useTransition();
  const pagesInput = useRef<HTMLInputElement>(null);
  const queriesInput = useRef<HTMLInputElement>(null);

  const handleFile = async (
    file: File | undefined,
    setCsv: (value: string) => void,
    setName: (value: string) => void,
  ) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({
        variant: "error",
        label: "Unsupported file",
        title: "Choose the CSV files from the Search Console export.",
      });
      return;
    }

    setCsv(await file.text());
    setName(file.name);
  };

  const handleImport = () => {
    startImport(async () => {
      const result = await importPerformanceExports({
        pagesCsv,
        queriesCsv,
      });

      if (!result.ok) {
        toast({
          variant: "error",
          label: "Import failed",
          title: result.error,
        });
        return;
      }

      toast({
        variant: "success",
        label: "Performance export imported",
        title: `${result.pages} pages and ${result.queries} queries added to the next analysis.`,
      });

      setPagesCsv("");
      setQueriesCsv("");
      setPagesName("");
      setQueriesName("");
      if (pagesInput.current) pagesInput.current.value = "";
      if (queriesInput.current) queriesInput.current.value = "";
      router.refresh();
    });
  };

  const canImport = Boolean(pagesCsv.trim() || queriesCsv.trim());

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Official performance export
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Import Pages.csv and Queries.csv from the Search Console performance
            export. The next analysis receives the longer-range pages and queries
            alongside the live API data.
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {importedAt
              ? `imported ${importedAt.slice(0, 16).replace("T", " ")} UTC · ${pageCount} pages · ${queryCount} queries`
              : "no export imported"}
          </p>
        </div>
      </header>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="block rounded border border-border bg-surface p-4 text-[13px] text-ink-muted">
          <span className="eyebrow block text-ink-faint">Pages.csv</span>
          <input
            ref={pagesInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) =>
              void handleFile(
                event.target.files?.[0],
                setPagesCsv,
                setPagesName,
              )
            }
            className="mt-2 block w-full text-[13px] text-ink-muted file:mr-3 file:rounded file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[13px] file:text-foreground"
          />
          <span className="mt-2 block font-mono text-[11px] text-ink-faint">
            {pagesName || "Top pages export"}
          </span>
        </label>

        <label className="block rounded border border-border bg-surface p-4 text-[13px] text-ink-muted">
          <span className="eyebrow block text-ink-faint">Queries.csv</span>
          <input
            ref={queriesInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) =>
              void handleFile(
                event.target.files?.[0],
                setQueriesCsv,
                setQueriesName,
              )
            }
            className="mt-2 block w-full text-[13px] text-ink-muted file:mr-3 file:rounded file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[13px] file:text-foreground"
          />
          <span className="mt-2 block font-mono text-[11px] text-ink-faint">
            {queriesName || "Top queries export"}
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={isImporting || !canImport}
          className="inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isImporting ? (
            <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <UploadSimple size={14} aria-hidden="true" />
          )}
          <span>{isImporting ? "Importing..." : "Import export"}</span>
        </button>
        <p className="text-[13px] text-ink-muted">
          Re-import after downloading a fresh export from Google.
        </p>
      </div>
    </section>
  );
}
