import prisma from "@/app/lib/prisma";
import { getKeywordPlannerSettings } from "@/app/lib/settings";
import KeywordsManager, {
  type KeywordItem,
  type KeywordMonthlyVolume,
} from "@/app/ui/keywords-manager";
import { WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseMonthlyVolumes(value: unknown): KeywordMonthlyVolume[] {
  if (!Array.isArray(value)) return [];

  const volumes: KeywordMonthlyVolume[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const year = record.year;
    const month = record.month;
    const monthlySearches = record.monthlySearches;
    if (
      typeof year !== "number" ||
      typeof month !== "string" ||
      typeof monthlySearches !== "number"
    ) {
      continue;
    }
    volumes.push({ year, month, monthlySearches });
  }
  return volumes;
}

function ConfigurationNotice({
  developerTokenSet,
  customerId,
}: {
  developerTokenSet: boolean;
  customerId: string;
}) {
  return (
    <div className="rounded-lg border border-border border-l-2 border-l-ink-faint bg-card px-5 py-4">
      <div className="flex items-start gap-3">
        <WarningCircle
          size={16}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-ink-faint"
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-faint">Setup needed</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            Keyword Planner is not configured
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-muted">
            {!developerTokenSet ? (
              <li>
                <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[12px]">
                  GOOGLE_ADS_DEVELOPER_TOKEN
                </code>{" "}
                is missing from the environment. It needs Basic access level or
                higher.
              </li>
            ) : null}
            {customerId.length === 0 ? (
              <li>
                The Google Ads customer ID is not set in the Keyword Planner
                settings.
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-[13px] text-ink-muted">
            Add the missing pieces in{" "}
            <Link
              href="/admin/settings"
              className="underline decoration-1 underline-offset-4 transition-colors hover:text-foreground"
            >
              Settings
            </Link>
            . Saved keywords stay available to review and edit; syncing and
            metric refreshes are disabled until the planner is configured.
          </p>
        </div>
      </div>
    </div>
  );
}

function microsToNumber(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

export default async function KeywordsPage() {
  const [keywords, planner] = await Promise.all([
    prisma.keyword.findMany({
      orderBy: { avgMonthlySearches: "desc" },
      take: 1000,
    }),
    getKeywordPlannerSettings(),
  ]);

  const developerTokenSet = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
  const plannerConfigured = developerTokenSet && planner.customerId.length > 0;

  const initialKeywords: KeywordItem[] = keywords.map((keyword) => ({
    id: keyword.id,
    keyword: keyword.keyword,
    avgMonthlySearches: keyword.avgMonthlySearches,
    competition: keyword.competition,
    competitionIndex: keyword.competitionIndex,
    lowTopOfPageBidMicros: microsToNumber(keyword.lowTopOfPageBidMicros),
    highTopOfPageBidMicros: microsToNumber(keyword.highTopOfPageBidMicros),
    monthlyVolumes: parseMonthlyVolumes(keyword.monthlyVolumes),
    source: keyword.source,
    status: keyword.status,
    postId: keyword.postId,
    usedAt: keyword.usedAt ? keyword.usedAt.toISOString() : null,
    fetchedAt: keyword.fetchedAt ? keyword.fetchedAt.toISOString() : null,
    updatedAt: keyword.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="eyebrow text-ink-faint">Keyword Planner</p>
        <h1 className="font-serif text-2xl tracking-[-0.01em] text-foreground">
          Keywords
        </h1>
        <p className="text-sm text-ink-muted">
          Search volume, competition, and bid ranges from Google Ads. Pick a
          keyword to write about and track what has already been written.
        </p>
      </header>

      {!plannerConfigured ? (
        <ConfigurationNotice
          developerTokenSet={developerTokenSet}
          customerId={planner.customerId}
        />
      ) : null}

      <KeywordsManager
        initialKeywords={initialKeywords}
        plannerConfigured={plannerConfigured}
      />
    </div>
  );
}
