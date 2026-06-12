import type {
  WebSearchProvider,
  WebSearchProviderModule,
  WebSearchResult,
} from "../../core/types.ts";
import { isRecord } from "../../core/helpers.ts";

class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly name = "duckduckgo";

  async search(request: {
    query: string;
    maxResults: number;
  }): Promise<{ provider: string; results: WebSearchResult[] }> {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", request.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    return {
      provider: this.name,
      results: normalizeDuckDuckGo(payload).slice(0, request.maxResults),
    };
  }
}

const module: WebSearchProviderModule = {
  metadata: {
    name: "duckduckgo",
    description: "No-key DuckDuckGo Instant Answer web search provider.",
    version: "0.1.0",
  },
  createProvider: () => new DuckDuckGoSearchProvider(),
};

function normalizeDuckDuckGo(payload: unknown): WebSearchResult[] {
  if (!isRecord(payload)) {
    return [];
  }

  const results: WebSearchResult[] = [];
  const abstractUrl = stringValue(payload.AbstractURL);
  const abstractText = stringValue(payload.AbstractText);
  const heading = stringValue(payload.Heading);

  if (abstractUrl && heading) {
    results.push({
      title: heading,
      url: abstractUrl,
      snippet: abstractText,
    });
  }

  collectTopics(payload.Results, results);
  collectTopics(payload.RelatedTopics, results);

  return dedupeResults(results);
}

function collectTopics(value: unknown, results: WebSearchResult[]): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (Array.isArray(item.Topics)) {
      collectTopics(item.Topics, results);
      continue;
    }

    const url = stringValue(item.FirstURL);
    const text = stringValue(item.Text);
    if (!url || !text) {
      continue;
    }

    results.push({
      title: text.split(" - ")[0] ?? text,
      url,
      snippet: text,
    });
  }
}

function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) {
      return false;
    }

    seen.add(result.url);
    return true;
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export default module;
