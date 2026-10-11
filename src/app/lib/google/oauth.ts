import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/app/lib/crypto";
import prisma from "@/app/lib/prisma";
import { resolveOAuthCredentials } from "./accounts";
import { GscApiError, GscAuthError, GscNotConnectedError } from "./errors";

export const GOOGLE_PROVIDER = "google";
export const OAUTH_STATE_COOKIE = "google_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "google_oauth_verifier";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/adwords",
] as const;

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

export interface GoogleConnectionSummary {
  connected: boolean;
  email: string | null;
  scope: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
  email: string | null;
}

export async function oauthCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  return resolveOAuthCredentials();
}

export async function isOAuthConfigured(): Promise<boolean> {
  return (await resolveOAuthCredentials()) !== null;
}

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function generateOAuthVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function buildAuthUrl(input: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): Promise<string> {
  const credentials = await oauthCredentials();
  if (!credentials) {
    throw new GscAuthError("Google OAuth client credentials are not configured.");
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTH_URL}?${params.toString()}`;
}

function decodeIdTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : null;
  } catch {
    return null;
  }
}

async function googleErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as GoogleTokenResponse;
    const parts = [data.error, data.error_description].filter(Boolean);
    return parts.length > 0 ? ` (${parts.join(": ")})` : "";
  } catch {
    return "";
  }
}

function tokenPayload(data: GoogleTokenResponse): GoogleTokens | null {
  if (!data.access_token || !data.expires_in) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in,
    scope: data.scope ?? GOOGLE_OAUTH_SCOPES.join(" "),
    email: decodeIdTokenEmail(data.id_token),
  };
}

export async function exchangeCodeForTokens(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GoogleTokens> {
  const credentials = await oauthCredentials();
  if (!credentials) {
    throw new GscAuthError(
      "Google OAuth client credentials are not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await googleErrorDetail(response);
    throw new GscAuthError(
      `Google token exchange failed (${response.status})${detail}. Try connecting again.`,
    );
  }

  const tokens = tokenPayload((await response.json()) as GoogleTokenResponse);
  if (!tokens) {
    throw new GscAuthError(
      "Google token exchange returned no access token. Try connecting again.",
    );
  }

  return tokens;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
  scope: string | null;
}> {
  const credentials = await oauthCredentials();
  if (!credentials) {
    throw new GscAuthError(
      "Google OAuth client credentials are not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }

  return refreshAccessTokenWith(credentials, refreshToken);
}

export async function refreshAccessTokenWith(
  credentials: { clientId: string; clientSecret: string },
  refreshToken: string,
): Promise<{
  accessToken: string;
  expiresIn: number;
  scope: string | null;
}> {

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await googleErrorDetail(response);
    throw new GscAuthError(
      `Google token refresh failed (${response.status})${detail}. Reconnect the account in settings.`,
    );
  }

  const data = (await response.json()) as GoogleTokenResponse;
  if (!data.access_token || !data.expires_in) {
    throw new GscAuthError(
      "Google token refresh returned no access token. Reconnect the account in settings.",
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope ?? null,
  };
}

export async function storeConnection(tokens: GoogleTokens): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const encryptedAccess = encryptSecret(tokens.accessToken);

  const existing = await prisma.googleConnection.findUnique({
    where: { provider: GOOGLE_PROVIDER },
  });

  const encryptedRefresh = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : existing?.refreshToken;

  if (!encryptedRefresh) {
    throw new GscAuthError(
      "Google returned no refresh token. Revoke the app access in your Google account and connect again so consent is re-shown.",
    );
  }

  await prisma.googleConnection.upsert({
    where: { provider: GOOGLE_PROVIDER },
    create: {
      provider: GOOGLE_PROVIDER,
      email: tokens.email,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiresAt,
      scope: tokens.scope,
    },
    update: {
      email: tokens.email ?? existing?.email ?? null,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiresAt,
      scope: tokens.scope,
    },
  });
}

export async function seedConnectionFromRefreshToken(input: {
  refreshToken: string;
  email?: string | null;
}): Promise<{ email: string | null }> {
  await storeConnection({
    accessToken: "seed-placeholder",
    refreshToken: input.refreshToken,
    expiresIn: 0,
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    email: input.email ?? null,
  });

  const accessToken = await getAccessToken();

  let email = input.email ?? null;
  if (!email) {
    try {
      const response = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (response.ok) {
        const profile = (await response.json()) as { email?: unknown };
        email =
          typeof profile.email === "string" && profile.email.length > 0
            ? profile.email
            : null;
      }
    } catch {
      // The email is optional; the connection stays usable without it.
    }
  }

  if (email) {
    await prisma.googleConnection.update({
      where: { provider: GOOGLE_PROVIDER },
      data: { email },
    });
  }

  return { email };
}

export async function getGoogleConnectionSummary(): Promise<GoogleConnectionSummary> {
  try {
    const row = await prisma.googleConnection.findUnique({
      where: { provider: GOOGLE_PROVIDER },
    });

    if (!row) {
      return { connected: false, email: null, scope: null, expiresAt: null, updatedAt: null };
    }

    return {
      connected: true,
      email: row.email,
      scope: row.scope,
      expiresAt: row.expiresAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    console.warn("Failed to read the Google connection row:", error);
    return { connected: false, email: null, scope: null, expiresAt: null, updatedAt: null };
  }
}

export async function isGoogleConnected(): Promise<boolean> {
  try {
    const row = await prisma.googleConnection.findUnique({
      where: { provider: GOOGLE_PROVIDER },
      select: { id: true },
    });
    return row !== null;
  } catch {
    return false;
  }
}

export async function getAccessToken(): Promise<string> {
  const row = await prisma.googleConnection.findUnique({
    where: { provider: GOOGLE_PROVIDER },
  });

  if (!row) {
    throw new GscNotConnectedError();
  }

  if (row.expiresAt.getTime() > Date.now() + 60_000) {
    try {
      return decryptSecret(row.accessToken);
    } catch {
      throw new GscAuthError(
        "The stored Google access token could not be decrypted. Reconnect the account in settings.",
      );
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refreshToken);
  } catch {
    throw new GscAuthError(
      "The stored Google refresh token could not be decrypted. Reconnect the account in settings.",
    );
  }

  const refreshed = await refreshAccessToken(refreshToken);
  await prisma.googleConnection.update({
    where: { id: row.id },
    data: {
      accessToken: encryptSecret(refreshed.accessToken),
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      ...(refreshed.scope ? { scope: refreshed.scope } : {}),
    },
  });

  return refreshed.accessToken;
}

export async function disconnect(): Promise<void> {
  const row = await prisma.googleConnection.findUnique({
    where: { provider: GOOGLE_PROVIDER },
  });
  if (!row) return;

  try {
    const refreshToken = decryptSecret(row.refreshToken);
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Best effort; the row is deleted regardless.
  }

  await prisma.googleConnection.deleteMany({ where: { provider: GOOGLE_PROVIDER } });
}

export async function listProperties(): Promise<GscProperty[]> {
  const accessToken = await getAccessToken();

  const response = await fetch(SITES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new GscAuthError(
      "Google rejected the Search Console request. Reconnect the account in settings.",
    );
  }

  if (!response.ok) {
    throw new GscApiError(
      response.status,
      `Google Search Console sites request failed (${response.status}).`,
    );
  }

  const data = (await response.json()) as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  };

  return (data.siteEntry ?? [])
    .filter(
      (entry): entry is { siteUrl: string; permissionLevel?: string } =>
        typeof entry.siteUrl === "string" && entry.siteUrl.length > 0,
    )
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: entry.permissionLevel ?? "unknown",
    }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}
