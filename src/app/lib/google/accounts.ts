import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/app/lib/crypto";
import prisma from "@/app/lib/prisma";
import {
  getKeywordPlannerSettings,
  getSetting,
  setSetting,
  SETTINGS_KEYS,
} from "@/app/lib/settings";

export const storedGoogleAccountSchema = z.object({
  label: z.string().min(1),
  googleAccount: z.string().default(""),
  customerId: z.string().default(""),
  loginCustomerId: z.string().default(""),
  developerToken: z.string().default(""),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
  refreshTokenStatus: z.string().default("unknown"),
});

export type StoredGoogleAccount = z.infer<typeof storedGoogleAccountSchema>;

const storedAccountsSchema = z.array(storedGoogleAccountSchema);

export interface GoogleAccountSummary {
  label: string;
  googleAccount: string;
  customerIdMasked: string;
  loginCustomerIdMasked: string;
  status: string;
  isActive: boolean;
  isAds: boolean;
}

function maskId(value: string): string {
  return value.length <= 4 ? "not set" : `****${value.slice(-4)}`;
}

export async function getStoredGoogleAccounts(): Promise<StoredGoogleAccount[]> {
  const raw = await getSetting<string | null>(
    SETTINGS_KEYS.googleAccounts,
    z.string().nullable(),
    null,
  );
  if (!raw) return [];

  try {
    const parsed = storedAccountsSchema.safeParse(
      JSON.parse(decryptSecret(raw)),
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export async function saveStoredGoogleAccounts(
  accounts: StoredGoogleAccount[],
): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.googleAccounts,
    encryptSecret(JSON.stringify(accounts)),
  );
}

export async function getActiveGoogleAccountLabel(): Promise<string | null> {
  const label = await getSetting<string | null>(
    SETTINGS_KEYS.googleActiveAccount,
    z.string().nullable(),
    null,
  );
  return label && label.length > 0 ? label : null;
}

export async function getActiveGoogleAccount(): Promise<StoredGoogleAccount | null> {
  const [accounts, label] = await Promise.all([
    getStoredGoogleAccounts(),
    getActiveGoogleAccountLabel(),
  ]);
  if (accounts.length === 0) return null;

  if (label) {
    const found = accounts.find((account) => account.label === label);
    if (found) return found;
  }

  return (
    accounts.find(
      (account) => account.refreshTokenStatus.toLowerCase() === "active",
    ) ??
    accounts[0] ??
    null
  );
}

export async function getGoogleAccountSummaries(): Promise<{
  accounts: GoogleAccountSummary[];
  activeLabel: string | null;
  adsLabel: string | null;
}> {
  const [accounts, active, adsLabel] = await Promise.all([
    getStoredGoogleAccounts(),
    getActiveGoogleAccount(),
    getSetting<string | null>(
      SETTINGS_KEYS.googleAdsAccount,
      z.string().nullable(),
      null,
    ),
  ]);

  return {
    activeLabel: active?.label ?? null,
    adsLabel,
    accounts: accounts.map((account) => ({
      label: account.label,
      googleAccount: account.googleAccount,
      customerIdMasked: maskId(account.customerId),
      loginCustomerIdMasked: maskId(account.loginCustomerId),
      status: account.refreshTokenStatus,
      isActive: account.label === active?.label,
      isAds: account.label === adsLabel,
    })),
  };
}

const adsTokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAdsAccessToken(): Promise<string> {
  const adsLabel = await getSetting<string | null>(
    SETTINGS_KEYS.googleAdsAccount,
    z.string().nullable(),
    null,
  );

  if (adsLabel) {
    const cached = adsTokenCache.get(adsLabel);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const accounts = await getStoredGoogleAccounts();
    const account = accounts.find((entry) => entry.label === adsLabel);
    if (!account) {
      throw new Error(
        "The flagged Keyword Planner account is no longer stored. Pick another Ads account in settings.",
      );
    }

    const { refreshAccessTokenWith } = await import("./oauth");
    try {
      const refreshed = await refreshAccessTokenWith(
        { clientId: account.clientId, clientSecret: account.clientSecret },
        account.refreshToken,
      );
      adsTokenCache.set(adsLabel, {
        token: refreshed.accessToken,
        expiresAt: Date.now() + refreshed.expiresIn * 1000,
      });
      return refreshed.accessToken;
    } catch (error) {
      throw new Error(
        `The stored Keyword Planner account could not refresh its token: ${
          error instanceof Error ? error.message : "unknown error"
        }. Re-import the handover file or pick another Ads account.`,
      );
    }
  }

  const { getAccessToken } = await import("./oauth");
  return getAccessToken();
}

export async function setAdsAccountLabel(
  label: string | null,
): Promise<void> {
  if (!label) {
    await setSetting(SETTINGS_KEYS.googleAdsAccount, null);
    return;
  }

  const accounts = await getStoredGoogleAccounts();
  if (!accounts.some((account) => account.label === label)) {
    throw new Error("That account is not in the stored set.");
  }
  await setSetting(SETTINGS_KEYS.googleAdsAccount, label);
}
export async function resolveOAuthCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const active = await getActiveGoogleAccount();
  if (active && active.clientId.length > 0 && active.clientSecret.length > 0) {
    return { clientId: active.clientId, clientSecret: active.clientSecret };
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function resolveDeveloperToken(): Promise<string | null> {
  const active = await getActiveGoogleAccount();
  if (active && active.developerToken.trim().length > 0) {
    return active.developerToken.trim();
  }

  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export interface ActivateAccountResult {
  ok: boolean;
  error?: string;
}

export async function activateGoogleAccount(
  label: string,
): Promise<ActivateAccountResult> {
  const accounts = await getStoredGoogleAccounts();
  const account = accounts.find((entry) => entry.label === label);
  if (!account) {
    return { ok: false, error: "That account is not in the stored set." };
  }
  if (!account.refreshToken) {
    return { ok: false, error: "That account has no refresh token stored." };
  }

  const { GOOGLE_OAUTH_SCOPES, refreshAccessTokenWith, storeConnection } =
    await import("./oauth");

  let refreshed: {
    accessToken: string;
    expiresIn: number;
    scope: string | null;
  };
  try {
    refreshed = await refreshAccessTokenWith(
      { clientId: account.clientId, clientSecret: account.clientSecret },
      account.refreshToken,
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Google rejected the refresh token: ${error.message}`
          : "Google rejected the refresh token.",
    };
  }

  await storeConnection({
    accessToken: refreshed.accessToken,
    refreshToken: account.refreshToken,
    expiresIn: refreshed.expiresIn,
    scope: refreshed.scope ?? GOOGLE_OAUTH_SCOPES.join(" "),
    email: account.googleAccount || null,
  });

  await prisma.googleConnection.update({
    where: { provider: "google" },
    data: { email: account.googleAccount || null },
  });

  const planner = await getKeywordPlannerSettings();
  await setSetting(SETTINGS_KEYS.keywordsPlanner, {
    ...planner,
    customerId: account.customerId,
    loginCustomerId: account.loginCustomerId,
  });

  await setSetting(SETTINGS_KEYS.googleActiveAccount, label);
  return { ok: true };
}

export async function captureConnectionIntoActiveAccount(): Promise<ActivateAccountResult> {
  const [row, active] = await Promise.all([
    prisma.googleConnection.findUnique({ where: { provider: "google" } }),
    getActiveGoogleAccount(),
  ]);

  if (!row) {
    return { ok: false, error: "There is no live Google connection to store." };
  }
  if (!active) {
    return {
      ok: false,
      error: "No stored account set. Import the handover file first.",
    };
  }

  if (
    row.email &&
    active.googleAccount &&
    row.email.toLowerCase() !== active.googleAccount.toLowerCase()
  ) {
    return {
      ok: false,
      error: `The live connection belongs to ${row.email}, which differs from the active stored account.`,
    };
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refreshToken);
  } catch {
    return {
      ok: false,
      error: "The live refresh token could not be decrypted.",
    };
  }

  const accounts = await getStoredGoogleAccounts();
  const index = accounts.findIndex((account) => account.label === active.label);
  if (index < 0) {
    return {
      ok: false,
      error: "The active account is no longer in the stored set.",
    };
  }

  const next = [...accounts];
  next[index] = {
    ...next[index],
    refreshToken,
    googleAccount: row.email ?? next[index].googleAccount,
    refreshTokenStatus: "active",
  };

  await saveStoredGoogleAccounts(next);
  return { ok: true };
}
