"use server";

import { auth } from "@/auth";
import { parsePerformanceCsv } from "@/app/lib/google/csv";
import { setSetting, SETTINGS_KEYS } from "@/app/lib/settings";
import { revalidatePath } from "next/cache";

export type ImportPerformanceResult =
  | { ok: true; pages: number; queries: number; importedAt: string }
  | { ok: false; error: string };

const MAX_CSV_BYTES = 2_000_000;

export async function importPerformanceExports(input: {
  pagesCsv: string;
  queriesCsv: string;
}): Promise<ImportPerformanceResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }

  const pagesCsv =
    typeof input.pagesCsv === "string" ? input.pagesCsv : "";
  const queriesCsv =
    typeof input.queriesCsv === "string" ? input.queriesCsv : "";

  if (!pagesCsv.trim() && !queriesCsv.trim()) {
    return { ok: false, error: "Choose at least one CSV file to import." };
  }

  if (
    Buffer.byteLength(pagesCsv, "utf8") > MAX_CSV_BYTES ||
    Buffer.byteLength(queriesCsv, "utf8") > MAX_CSV_BYTES
  ) {
    return { ok: false, error: "The CSV file is too large." };
  }

  const pages = pagesCsv.trim() ? parsePerformanceCsv(pagesCsv) : [];
  const queries = queriesCsv.trim() ? parsePerformanceCsv(queriesCsv) : [];

  if (pages.length === 0 && queries.length === 0) {
    return {
      ok: false,
      error:
        "No rows were found. Use the Pages.csv and Queries.csv files from the Search Console performance export.",
    };
  }

  const importedAt = new Date().toISOString();

  await setSetting(SETTINGS_KEYS.performanceSnapshot, {
    importedAt,
    pages,
    queries,
  });

  revalidatePath("/admin/search-console");

  return { ok: true, pages: pages.length, queries: queries.length, importedAt };
}
