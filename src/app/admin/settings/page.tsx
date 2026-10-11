import { listModels } from "@/app/lib/ai/models";
import { isEncryptionConfigured } from "@/app/lib/crypto";
import {
  getGoogleConnectionSummary,
  isOAuthConfigured,
} from "@/app/lib/google/oauth";
import { getGoogleAccountSummaries } from "@/app/lib/google/accounts";
import {
  getAnalysisSettings,
  getGenerationSettings,
  getGscProperty,
  getImageSettings,
  getKeywordPlannerSettings,
  getReviewSettings,
} from "@/app/lib/settings";
import AiModelSettings from "@/app/ui/ai-model-settings";
import GoogleConnectNotice from "@/app/ui/google-connect-notice";
import GoogleConnectionCard from "@/app/ui/google-connection-card";
import KeywordPlannerSettingsCard from "@/app/ui/keyword-planner-settings";

export const dynamic = "force-dynamic";

type SettingsSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SettingsSearchParams;
}) {
  const params = await searchParams;
  const googleParam = firstValue(params.google);
  const reason = firstValue(params.reason);
  const googleStatus =
    googleParam === "connected"
      ? "connected"
      : googleParam === "error"
        ? "error"
        : undefined;

  const [
    generation,
    review,
    image,
    analysis,
    property,
    connection,
    planner,
    accountSet,
  ] = await Promise.all([
    getGenerationSettings(),
    getReviewSettings(),
    getImageSettings(),
    getAnalysisSettings(),
    getGscProperty(),
    getGoogleConnectionSummary(),
    getKeywordPlannerSettings(),
    getGoogleAccountSummaries(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl tracking-[-0.01em] text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Choose the OpenCode Go models used for generation, review, image
          prompts, and search analysis, and connect the Google account used by
          the Search Console dashboard.
        </p>
      </div>

      <GoogleConnectNotice status={googleStatus} reason={reason} />

      <GoogleConnectionCard
        connected={connection.connected}
        email={connection.email}
        scope={connection.scope}
        expiresAt={connection.expiresAt}
        property={property}
        encryptionConfigured={isEncryptionConfigured()}
        oauthConfigured={await isOAuthConfigured()}
        accounts={accountSet.accounts}
      />

      <KeywordPlannerSettingsCard
        settings={planner}
        developerTokenConfigured={Boolean(
          process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        )}
      />

      <AiModelSettings
        models={listModels()}
        generation={generation}
        review={review}
        image={image}
        analysis={analysis}
        apiKeyConfigured={Boolean(process.env.OPENCODE_GO_API_KEY)}
      />
    </div>
  );
}
