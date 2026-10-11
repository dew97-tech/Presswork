import { getKeywordPlannerSettings } from "@/app/lib/settings";
import type { KeywordPlannerSettings } from "@/app/lib/settings";
import { getAdsAccessToken, resolveDeveloperToken } from "./accounts";

export const GOOGLE_ADS_API_VERSION = "v25";

const ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GEO_TARGET_PREFIX = "geoTargetConstants/";
const LANGUAGE_PREFIX = "languageConstants/";
const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_000;
const MAX_HISTORICAL_KEYWORDS = 700;

export class GoogleAdsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAdsConfigError";
  }
}

export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly hint: string | null;

  constructor(status: number, message: string, hint: string | null) {
    super(message);
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.hint = hint;
  }
}

export interface KeywordIdea {
  keyword: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
  monthlyVolumes: Array<{ year: number; month: string; monthlySearches: number }>;
}

interface KeywordMetricsPayload {
  avgMonthlySearches?: unknown;
  competition?: unknown;
  competitionIndex?: unknown;
  lowTopOfPageBidMicros?: unknown;
  highTopOfPageBidMicros?: unknown;
  monthlySearchVolumes?: unknown;
}

interface KeywordIdeaResult {
  text?: unknown;
  keywordIdeaMetrics?: KeywordMetricsPayload;
  keywordMetrics?: KeywordMetricsPayload;
}

interface KeywordIdeaResponse {
  results?: KeywordIdeaResult[];
}

interface GoogleAdsErrorDetail {
  reason?: unknown;
  errors?: unknown;
}

interface GoogleAdsErrorBody {
  error?: {
    message?: unknown;
    status?: unknown;
    details?: unknown;
  };
}

function withoutPrefix(value: string, prefix: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function geoTargetConstant(geo: string): string {
  return `${GEO_TARGET_PREFIX}${withoutPrefix(geo, GEO_TARGET_PREFIX)}`;
}

function languageConstant(language: string): string {
  return `${LANGUAGE_PREFIX}${withoutPrefix(language, LANGUAGE_PREFIX)}`;
}

export async function resolveKeywordPlannerConfig(): Promise<{
  settings: KeywordPlannerSettings;
  developerToken: string;
}> {
  const developerToken = (await resolveDeveloperToken()) ?? "";
  if (developerToken.length === 0) {
    throw new GoogleAdsConfigError(
      "The Google Ads developer token is missing. Set GOOGLE_ADS_DEVELOPER_TOKEN or store an account with a developer token.",
    );
  }

  const stored = await getKeywordPlannerSettings();
  if (stored.customerId.trim().length === 0) {
    throw new GoogleAdsConfigError(
      "The Ads customer ID is missing. Add it in the Keyword Planner settings.",
    );
  }

  return {
    developerToken,
    settings: {
      ...stored,
      customerId: stored.customerId.trim(),
      loginCustomerId: stored.loginCustomerId.trim(),
      geo: withoutPrefix(stored.geo, GEO_TARGET_PREFIX),
      language: withoutPrefix(stored.language, LANGUAGE_PREFIX),
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status < 500 || attempt > 0) {
        return response;
      }
    } catch (error) {
      if (attempt > 0) {
        throw error;
      }
    }
    await sleep(RETRY_DELAY_MS);
  }
}

async function parseGoogleAdsError(response: Response): Promise<{
  message: string;
  hint: string | null;
}> {
  let body: GoogleAdsErrorBody = {};
  try {
    const data: unknown = await response.json();
    if (typeof data === "object" && data !== null) {
      body = data as GoogleAdsErrorBody;
    }
  } catch {
    // Fall back to a status-only message.
  }

  const googleMessage =
    typeof body.error?.message === "string" && body.error.message.length > 0
      ? body.error.message
      : null;
  const message =
    googleMessage ?? `Google Ads request failed (${response.status}).`;

  const reasons: string[] = [];
  if (Array.isArray(body.error?.details)) {
    for (const detail of body.error.details) {
      if (typeof detail !== "object" || detail === null) continue;
      const record = detail as GoogleAdsErrorDetail;
      if (typeof record.reason === "string" && record.reason.length > 0) {
        reasons.push(record.reason);
      }

      if (Array.isArray(record.errors)) {
        for (const entry of record.errors) {
          if (typeof entry !== "object" || entry === null) continue;
          const errorCode = (entry as { errorCode?: unknown }).errorCode;
          if (typeof errorCode !== "object" || errorCode === null) continue;
          for (const value of Object.values(errorCode as Record<string, unknown>)) {
            if (
              typeof value === "string" &&
              value.length > 0 &&
              value !== "UNSPECIFIED" &&
              value !== "UNKNOWN"
            ) {
              reasons.push(value);
            }
          }
        }
      }
    }
  }

  const googleStatus = typeof body.error?.status === "string" ? body.error.status : "";
  const codes = [googleStatus, ...reasons];
  const hasCode = (fragment: string) =>
    codes.some((code) => code.includes(fragment));

  let hint: string | null = null;
  if (hasCode("DEVELOPER_TOKEN") || /developer token/i.test(googleMessage ?? "")) {
    hint = "The developer token is missing Basic access.";
  } else if (hasCode("INVALID_LOGIN_CUSTOMER_ID")) {
    hint = "The login customer ID (MCC) does not match this Ads account.";
  } else if (hasCode("CUSTOMER_NOT_FOUND") || hasCode("INVALID_CUSTOMER_ID")) {
    hint = "Check the Ads customer ID.";
  } else if (hasCode("PERMISSION_DENIED") || hasCode("ACCESS_DENIED")) {
    hint = "The connected Google account cannot access this Ads account.";
  } else if (
    hasCode("EXHAUSTED") ||
    hasCode("QUOTA_ERROR") ||
    hasCode("RATE_LIMIT")
  ) {
    hint = "Rate limited by Google Ads; retry later.";
  } else if (
    hasCode("UNAUTHENTICATED") ||
    hasCode("OAUTH_TOKEN") ||
    hasCode("AUTHENTICATION_ERROR")
  ) {
    hint = "Reconnect the Google account in settings.";
  }

  return { message, hint };
}

async function adsRequest<T>(input: {
  customerId: string;
  developerToken: string;
  loginCustomerId: string;
  operation: string;
  body: unknown;
}): Promise<T> {
  const accessToken = await getAdsAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": input.developerToken,
    "Content-Type": "application/json",
  };
  if (input.loginCustomerId.length > 0) {
    headers["login-customer-id"] = input.loginCustomerId;
  }

  const response = await fetchWithRetry(
    `${ADS_API_BASE}/customers/${encodeURIComponent(input.customerId)}:${input.operation}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const { message, hint } = await parseGoogleAdsError(response);
    throw new GoogleAdsApiError(response.status, message, hint);
  }

  return (await response.json()) as T;
}

function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapMonthlyVolumes(value: unknown): KeywordIdea["monthlyVolumes"] {
  if (!Array.isArray(value)) return [];

  const volumes: KeywordIdea["monthlyVolumes"] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const year = numericOrNull(record.year);
    const month = typeof record.month === "string" ? record.month : null;
    const monthlySearches = numericOrNull(record.monthlySearches);
    if (year === null || month === null || monthlySearches === null) continue;
    volumes.push({ year, month, monthlySearches });
  }
  return volumes;
}

function mapKeywordIdea(
  result: KeywordIdeaResult,
  metricsKey: "keywordIdeaMetrics" | "keywordMetrics",
): KeywordIdea | null {
  const keyword = typeof result.text === "string" ? result.text.trim() : "";
  if (keyword.length === 0) return null;

  const metrics = result[metricsKey];
  return {
    keyword,
    avgMonthlySearches: numericOrNull(metrics?.avgMonthlySearches),
    competition:
      typeof metrics?.competition === "string" ? metrics.competition : null,
    competitionIndex: numericOrNull(metrics?.competitionIndex),
    lowTopOfPageBidMicros: numericOrNull(metrics?.lowTopOfPageBidMicros),
    highTopOfPageBidMicros: numericOrNull(metrics?.highTopOfPageBidMicros),
    monthlyVolumes: mapMonthlyVolumes(metrics?.monthlySearchVolumes),
  };
}

function mapKeywordIdeas(
  response: KeywordIdeaResponse,
  metricsKey: "keywordIdeaMetrics" | "keywordMetrics",
): KeywordIdea[] {
  return (response.results ?? [])
    .map((result) => mapKeywordIdea(result, metricsKey))
    .filter((idea): idea is KeywordIdea => idea !== null);
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

export async function generateKeywordIdeas(input: {
  seeds?: string[];
  url?: string;
}): Promise<KeywordIdea[]> {
  const seeds = (input.seeds ?? [])
    .map((seed) => seed.trim())
    .filter((seed) => seed.length > 0);
  const url = input.url?.trim() ?? "";

  let seedField: "keywordAndUrlSeed" | "urlSeed" | "keywordSeed";
  let seedValue: { keywords?: string[]; url?: string };
  if (url.length > 0 && seeds.length > 0) {
    seedField = "keywordAndUrlSeed";
    seedValue = { keywords: seeds, url };
  } else if (url.length > 0) {
    seedField = "urlSeed";
    seedValue = { url };
  } else if (seeds.length > 0) {
    seedField = "keywordSeed";
    seedValue = { keywords: seeds };
  } else {
    throw new GoogleAdsConfigError("Provide keyword seeds or a site URL.");
  }

  const { settings, developerToken } = await resolveKeywordPlannerConfig();

  const body: Record<string, unknown> = {
    language: languageConstant(settings.language),
    geoTargetConstants: [geoTargetConstant(settings.geo)],
    includeAdultKeywords: false,
    keywordPlanNetwork: settings.network,
    [seedField]: seedValue,
  };

  const response = await adsRequest<KeywordIdeaResponse>({
    customerId: settings.customerId,
    developerToken,
    loginCustomerId: settings.loginCustomerId,
    operation: "generateKeywordIdeas",
    body,
  });

  return mapKeywordIdeas(response, "keywordIdeaMetrics");
}

export async function generateHistoricalMetrics(
  keywords: string[],
): Promise<KeywordIdea[]> {
  const unique = dedupeKeywords(keywords).slice(0, MAX_HISTORICAL_KEYWORDS);
  if (unique.length === 0) return [];

  const { settings, developerToken } = await resolveKeywordPlannerConfig();

  const response = await adsRequest<KeywordIdeaResponse>({
    customerId: settings.customerId,
    developerToken,
    loginCustomerId: settings.loginCustomerId,
    operation: "generateKeywordHistoricalMetrics",
    body: {
      keywords: unique,
      language: languageConstant(settings.language),
      geoTargetConstants: [geoTargetConstant(settings.geo)],
      keywordPlanNetwork: settings.network,
    },
  });

  return mapKeywordIdeas(response, "keywordMetrics");
}
