import { createSign } from "node:crypto";
import { getGscProperty } from "@/app/lib/settings";
import { GscApiError, GscAuthError } from "./errors";
import { getAccessToken, isGoogleConnected } from "./oauth";

export { GscApiError, GscAuthError, GscNotConnectedError } from "./errors";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SERVICE_ACCOUNT_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SITES_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const INSPECTION_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export interface SearchQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GscDimension =
  | "date"
  | "query"
  | "page"
  | "country"
  | "device"
  | "searchAppearance";

export interface GscDateRange {
  startDate: string;
  endDate: string;
}

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscFilter {
  dimension: string;
  operator: "equals" | "contains";
  expression: string;
}

export interface GscQueryParams {
  startDate: string;
  endDate: string;
  dimensions: GscDimension[];
  rowLimit?: number;
  filters?: GscFilter[];
  dataState?: "final" | "all" | "hourly_all";
}

export interface UrlInspectionResult {
  verdict: string | null;
  coverageState: string | null;
  lastCrawlTime: string | null;
  pageFetchState: string | null;
  indexingState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  sitemaps: string[];
}

interface TokenResponse {
  access_token?: string;
}

interface AnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface AnalyticsResponse {
  rows?: AnalyticsRow[];
}

interface GoogleErrorBody {
  error?: { message?: string; status?: string };
}

function serviceAccountCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const property = process.env.GSC_PROPERTY;

  if (!email || !key || !property) {
    return null;
  }

  return { email, key, property };
}

export function isSearchConsoleConfigured(): boolean {
  return serviceAccountCredentials() !== null;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function getServiceAccountToken(email: string, key: string): Promise<string> {
  const issued = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SERVICE_ACCOUNT_SCOPE,
      aud: TOKEN_URL,
      iat: issued,
      exp: issued + 3600,
    }),
  );

  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(key, "base64url");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error("Google token exchange returned no access token");
  }

  return data.access_token;
}

function isoDay(offsetDays: number): string {
  const date = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export async function fetchSearchQueries(limit = 20): Promise<SearchQuery[]> {
  const config = serviceAccountCredentials();
  if (!config) return [];

  try {
    const token = await getServiceAccountToken(config.email, config.key);

    const response = await fetch(
      `${SITES_URL}/${encodeURIComponent(config.property)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: isoDay(31),
          endDate: isoDay(3),
          dimensions: ["query"],
          rowLimit: limit,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) return [];

    const data = (await response.json()) as AnalyticsResponse;

    return (data.rows ?? [])
      .map((row) => ({
        query: row.keys?.[0]?.trim() ?? "",
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        position: row.position ?? 0,
      }))
      .filter((row) => row.query.length > 0);
  } catch {
    return [];
  }
}

export async function isGscConnected(): Promise<boolean> {
  return isGoogleConnected();
}

async function gscRequest<T>(url: string, init: RequestInit): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new GscAuthError(
      "Google rejected the Search Console request. Reconnect the account in settings.",
    );
  }

  if (!response.ok) {
    let detail = `Google Search Console request failed (${response.status}).`;
    try {
      const body = (await response.json()) as GoogleErrorBody;
      if (body.error?.message) {
        detail = `Google Search Console: ${body.error.message} (${response.status})`;
      }
    } catch {
      // Keep the status-only message.
    }
    throw new GscApiError(response.status, detail);
  }

  return (await response.json()) as T;
}

function mapRows(rows: AnalyticsRow[] | undefined): GscRow[] {
  return (rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}

function clampRowLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 25_000);
}

export async function gscQuery(params: GscQueryParams): Promise<GscRow[]> {
  const property = await getGscProperty();

  const body: Record<string, unknown> = {
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions: params.dimensions,
    rowLimit: clampRowLimit(params.rowLimit, 100),
  };
  if (params.filters && params.filters.length > 0) {
    body.dimensionFilterGroups = [
      { filters: params.filters },
    ];
  }
  if (params.dataState) {
    body.dataState = params.dataState;
  }

  const data = await gscRequest<AnalyticsResponse>(
    `${SITES_URL}/${encodeURIComponent(property)}/searchAnalytics/query`,
    { method: "POST", body: JSON.stringify(body) },
  );

  return mapRows(data.rows);
}

export async function fetchTotals(range: GscDateRange): Promise<GscTotals> {
  const rows = await gscQuery({
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: [],
    rowLimit: 1,
  });

  const row = rows[0];
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0,
  };
}

export async function fetchTimeseries(range: GscDateRange): Promise<GscRow[]> {
  return gscQuery({
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: ["date"],
    rowLimit: 500,
  });
}

export async function fetchByDimension(
  dim: Exclude<GscDimension, "date" | "searchAppearance">,
  range: GscDateRange,
  limit = 50,
  filters?: GscFilter[],
): Promise<GscRow[]> {
  return gscQuery({
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: [dim],
    rowLimit: limit,
    filters,
  });
}

export async function inspectUrl(
  inspectionUrl: string,
): Promise<UrlInspectionResult> {
  const siteUrl = await getGscProperty();

  const data = await gscRequest<{
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        lastCrawlTime?: string;
        pageFetchState?: string;
        indexingState?: string;
        googleCanonical?: string;
        userCanonical?: string;
        sitemap?: string[];
      };
    };
  }>(INSPECTION_URL, {
    method: "POST",
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: "en-US" }),
  });

  const result = data.inspectionResult?.indexStatusResult;

  return {
    verdict: result?.verdict ?? null,
    coverageState: result?.coverageState ?? null,
    lastCrawlTime: result?.lastCrawlTime ?? null,
    pageFetchState: result?.pageFetchState ?? null,
    indexingState: result?.indexingState ?? null,
    googleCanonical: result?.googleCanonical ?? null,
    userCanonical: result?.userCanonical ?? null,
    sitemaps: result?.sitemap ?? [],
  };
}
