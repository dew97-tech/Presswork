"use client";

import {
  disconnectGoogleAccount,
  fetchGscProperties,
  saveGscProperty,
} from "@/app/lib/google/oauth-actions";
import { switchGoogleAccount, storeCurrentConnection, flagAdsGoogleAccount } from "@/app/lib/google/accounts-actions";
import type { GoogleAccountSummary } from "@/app/lib/google/accounts";
import PropertyPicker from "@/app/ui/property-picker";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowsLeftRight,
  CircleNotch,
  FloppyDisk,
  LinkSimple,
  Plugs,
  PlugsConnected,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

function shortScope(scope: string): string {
  const prefix = "https://www.googleapis.com/auth/";
  return scope.startsWith(prefix) ? scope.slice(prefix.length) : scope;
}

function formatExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

const secondaryButtonClassName =
  "inline-flex h-11 items-center gap-1.5 rounded border border-border px-3 text-[13px] text-ink-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClassName =
  "inline-flex h-11 items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

export default function GoogleConnectionCard({
  connected,
  email,
  scope,
  expiresAt,
  property,
  encryptionConfigured,
  oauthConfigured,
  accounts,
}: {
  connected: boolean;
  email: string | null;
  scope: string | null;
  expiresAt: string | null;
  property: string;
  encryptionConfigured: boolean;
  oauthConfigured: boolean;
  accounts: GoogleAccountSummary[];
}) {
  const { toast } = useToast();
  const router = useRouter();

  const [propertyValue, setPropertyValue] = useState(property);
  const [properties, setProperties] = useState<
    Array<{ siteUrl: string; permissionLevel: string }>
  >([]);
  const [isListing, startList] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isDisconnecting, startDisconnect] = useTransition();
  const [isSwitching, startSwitch] = useTransition();
  const [isStoring, startStore] = useTransition();
  const [isFlaggingAds, startFlagAds] = useTransition();
  const [adsPendingLabel, setAdsPendingLabel] = useState<string | null>(null);
  const [switchPendingLabel, setSwitchPendingLabel] = useState<string | null>(
    null,
  );

  const canConnect = encryptionConfigured && oauthConfigured;
  const scopes = scope ? scope.split(" ").filter(Boolean) : [];
  const expiryLabel = formatExpiry(expiresAt);

  const handleListProperties = () => {
    startList(async () => {
      const result = await fetchGscProperties();
      if (!result.ok) {
        toast({
          variant: "error",
          label: "Property list failed",
          title: result.error,
        });
        return;
      }

      setProperties(result.properties);
      toast({
        variant: "info",
        label: "Properties loaded",
        title:
          result.properties.length === 0
            ? "This Google account does not manage any Search Console properties."
            : `${result.properties.length} propert${
                result.properties.length === 1 ? "y" : "ies"
              } available.`,
      });
    });
  };

  const handleSaveProperty = () => {
    startSave(async () => {
      const result = await saveGscProperty(propertyValue);
      if (result.ok) {
        toast({
          variant: "success",
          label: "Property saved",
          title: "The dashboard will use this Search Console property.",
        });
        router.refresh();
      } else {
        toast({
          variant: "error",
          label: "Save failed",
          title: result.error ?? "Could not save the property.",
        });
      }
    });
  };

  const handleDisconnect = () => {
    if (
      !window.confirm(
        "Disconnect the Google account? Stored tokens are revoked and deleted; the dashboard and keyword sync will need a new connection.",
      )
    ) {
      return;
    }

    startDisconnect(async () => {
      const result = await disconnectGoogleAccount();
      if (result.ok) {
        toast({
          variant: "success",
          label: "Google disconnected",
          title: "The stored tokens were revoked and deleted.",
        });
        router.refresh();
      } else {
        toast({
          variant: "error",
          label: "Disconnect failed",
          title: result.error ?? "Could not disconnect Google.",
        });
      }
    });
  };

  const handleSwitch = (label: string) => {
    setSwitchPendingLabel(label);
    startSwitch(async () => {
      try {
        const result = await switchGoogleAccount(label);
        if (result.ok) {
          toast({
            variant: "success",
            label: "Account switched",
            title: "The connection and planner customer were updated.",
          });
          router.refresh();
          return;
        }
        toast({
          variant: "error",
          label: "Switch failed",
          title: result.error ?? "Could not switch the Google account.",
        });
      } finally {
        setSwitchPendingLabel(null);
      }
    });
  };

  const handleFlagAds = (label: string | null) => {
    setAdsPendingLabel(label);
    startFlagAds(async () => {
      try {
        const result = await flagAdsGoogleAccount(label);
        if (result.ok) {
          toast({
            variant: "success",
            label: "Ads identity updated",
            title: label
              ? "Keyword Planner calls now use this account's token."
              : "Keyword Planner calls now use the live connection.",
          });
          router.refresh();
          return;
        }
        toast({
          variant: "error",
          label: "Update failed",
          title: result.error ?? "Could not update the Ads identity.",
        });
      } finally {
        setAdsPendingLabel(null);
      }
    });
  };

  const handleStoreConnection = () => {
    startStore(async () => {
      const result = await storeCurrentConnection();
      if (result.ok) {
        toast({
          variant: "success",
          label: "Token stored",
          title: "The active account now holds this connection's token.",
        });
        router.refresh();
        return;
      }
      toast({
        variant: "error",
        label: "Store failed",
        title: result.error ?? "Could not store the connection token.",
      });
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl tracking-[-0.01em] text-foreground">
            Google Search Console
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Connect the Google account that owns the Search Console property.
            The dashboard reads performance and index data with this
            connection; the service account stays available as a generation
            fallback.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 rounded-full",
              connected ? "bg-ok" : "bg-ink-faint",
            )}
          />
          <span
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.08em]",
              connected ? "text-ok" : "text-ink-faint",
            )}
          >
            {connected ? "Connected" : "Not connected"}
          </span>
        </div>
      </header>

      {connected ? (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm text-foreground">
              {email ?? "Google account connected"}
            </span>
            {expiryLabel ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                token expires {expiryLabel}
              </span>
            ) : null}
          </div>

          {scopes.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Granted scopes">
              {scopes.map((item) => (
                <li
                  key={item}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint"
                >
                  {shortScope(item)}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canConnect ? (
              <a href="/api/google/oauth/start" className={primaryButtonClassName}>
                <PlugsConnected size={14} aria-hidden="true" />
                <span>Update access</span>
              </a>
            ) : (
              <button type="button" disabled className={primaryButtonClassName}>
                <PlugsConnected size={14} aria-hidden="true" />
                <span>Update access</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className={secondaryButtonClassName}
            >
              {isDisconnecting ? (
                <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
              ) : null}
              <span>Disconnect</span>
            </button>
          </div>

          <p className="mt-2 text-[13px] text-ink-muted">
            Update access re-runs Google consent and refreshes the stored
            tokens without disconnecting. Use it after a scope change.
          </p>
        </div>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {canConnect ? (
              <a href="/api/google/oauth/start" className={primaryButtonClassName}>
                <Plugs size={14} aria-hidden="true" />
                <span>Connect Google account</span>
              </a>
            ) : (
              <button type="button" disabled className={primaryButtonClassName}>
                <Plugs size={14} aria-hidden="true" />
                <span>Connect Google account</span>
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
              <LinkSimple size={14} aria-hidden="true" />
              Sensitive scopes show Google&apos;s unverified-app warning once.
            </span>
          </div>

          {!canConnect ? (
            <ul className="mt-3 space-y-1.5">
              {!encryptionConfigured ? (
                <li className="flex items-start gap-2 text-[13px] text-danger">
                  <WarningCircle
                    size={14}
                    weight="fill"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[12px]">
                      SETTINGS_ENCRYPTION_KEY
                    </code>{" "}
                    is missing. Generate one with openssl rand -base64 32 before
                    connecting.
                  </span>
                </li>
              ) : null}
              {!oauthConfigured ? (
                <li className="flex items-start gap-2 text-[13px] text-danger">
                  <WarningCircle
                    size={14}
                    weight="fill"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[12px]">
                      GOOGLE_OAUTH_CLIENT_ID
                    </code>{" "}
                    and{" "}
                    <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[12px]">
                      GOOGLE_OAUTH_CLIENT_SECRET
                    </code>{" "}
                    are missing. See DEPLOYMENT.md for the OAuth setup.
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}

      {accounts.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow text-ink-faint">Account rotation</span>
            <span className="text-[12px] text-ink-faint">
              {accounts.length} stored account{accounts.length === 1 ? "" : "s"}
            </span>
          </div>

          <ul className="mt-3 space-y-2">
            {accounts.map((account) => (
              <li
                key={account.label}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {account.googleAccount || account.label}
                    {account.isActive ? (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ok">
                        active
                      </span>
                    ) : null}
                    {account.isAds ? (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                        ads
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                    customer {account.customerIdMasked}
                    {account.loginCustomerIdMasked !== "not set"
                      ? ` | login ${account.loginCustomerIdMasked}`
                      : ""}
                    {` | ${account.status}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {account.isAds ? (
                    <button
                      type="button"
                      onClick={() => handleFlagAds(null)}
                      disabled={isFlaggingAds}
                      className={secondaryButtonClassName}
                    >
                      {adsPendingLabel === null && isFlaggingAds ? (
                        <CircleNotch
                          size={14}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>Use live connection</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleFlagAds(account.label)}
                      disabled={isFlaggingAds}
                      className={secondaryButtonClassName}
                    >
                      {adsPendingLabel === account.label ? (
                        <CircleNotch
                          size={14}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>Use for Ads</span>
                    </button>
                  )}
                  {account.isActive ? null : (
                    <button
                      type="button"
                      onClick={() => handleSwitch(account.label)}
                      disabled={!canConnect || isSwitching}
                      className={secondaryButtonClassName}
                    >
                      {switchPendingLabel === account.label ? (
                        <CircleNotch
                          size={14}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowsLeftRight size={14} aria-hidden="true" />
                      )}
                      <span>Switch</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose text-[13px] text-ink-muted">
              Switching replaces the live connection with the selected
              account&apos;s stored token and aligns the Keyword Planner
              customer ID. Use for Ads pins one account&apos;s token for
              Keyword Planner calls without touching the Search Console
              connection. After reconnecting in the browser, store the new
              token so future switches keep it. Secrets never leave the server.
            </p>
            <button
              type="button"
              onClick={handleStoreConnection}
              disabled={!connected || isStoring}
              className={secondaryButtonClassName}
            >
              {isStoring ? (
                <CircleNotch
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <FloppyDisk size={14} aria-hidden="true" />
              )}
              <span>Store current token</span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 border-t border-border pt-4">
        <label
          htmlFor="gsc-property"
          className="eyebrow text-ink-faint"
        >
          Search Console property
        </label>
        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start">
          <PropertyPicker
            value={propertyValue}
            onChange={setPropertyValue}
            options={properties}
            savedValue={property}
            disabled={!connected}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleListProperties}
              disabled={!connected || isListing}
              className={secondaryButtonClassName}
            >
              {isListing ? (
                <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
              ) : null}
              <span>Load properties</span>
            </button>
            <button
              type="button"
              onClick={handleSaveProperty}
              disabled={isSaving}
              className={secondaryButtonClassName}
            >
              {isSaving ? (
                <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <FloppyDisk size={14} aria-hidden="true" />
              )}
              <span>Save property</span>
            </button>
          </div>
        </div>
        <p className="mt-2 text-[13px] text-ink-muted">
          When GSC_PROPERTY is set, it is the default. Otherwise the dashboard
          uses{" "}
          <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[12px]">
            sc-domain:davidmallick.dev
          </code>
          .
        </p>
      </div>
    </section>
  );
}
