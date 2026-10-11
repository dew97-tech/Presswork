const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  results: SearchResult[];
  degraded: boolean;
}

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}

export function isWebSearchConfigured(): boolean {
  return (
    process.env.WEB_SEARCH_PROVIDER === "tavily" &&
    Boolean(process.env.WEB_SEARCH_API_KEY)
  );
}

async function tavilySearch(
  query: string,
  apiKey: string,
  limit: number,
): Promise<SearchResult[]> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      include_answer: false,
      search_depth: "basic",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status})`);
  }

  const data = (await response.json()) as TavilyResponse;

  return (data.results ?? [])
    .filter(
      (item): item is { title: string; url: string; content?: string } =>
        Boolean(item.title && item.url),
    )
    .map((item) => ({
      title: item.title,
      url: item.url,
      snippet: (item.content ?? "").replace(/\s+/g, " ").slice(0, 400),
    }));
}

export async function searchWeb(
  queries: string[],
  limitPerQuery = 3,
): Promise<WebSearchOutcome> {
  const provider = process.env.WEB_SEARCH_PROVIDER;
  const apiKey = process.env.WEB_SEARCH_API_KEY;

  if (provider !== "tavily" || !apiKey) {
    return { results: [], degraded: true };
  }

  const collected: SearchResult[] = [];
  let failures = 0;

  for (const query of queries) {
    if (!query.trim()) continue;

    try {
      collected.push(...(await tavilySearch(query, apiKey, limitPerQuery)));
    } catch (error) {
      failures += 1;
      console.warn(
        "Web search query failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const seen = new Set<string>();
  const results = collected
    .filter((result) => {
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    })
    .slice(0, 8);

  return {
    results,
    degraded: results.length === 0 && (failures > 0 || queries.length > 0),
  };
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No web search results available. Mark search-dependent claims as unverifiable.";
  }

  return results
    .map(
      (result, index) =>
        `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`,
    )
    .join("\n\n");
}
