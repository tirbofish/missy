import type {
  ConfigSchema,
  LlmContextRequest,
  LlmContextResult,
  WebSearchProvider,
  WebSearchProviderModule,
  WebSearchResult,
} from "../../core/types.ts";
import { isRecord } from "../../core/helpers.ts";

class BraveSearchProvider implements WebSearchProvider {
  readonly name = "brave";

  constructor(private readonly apiKey: string | undefined) {}

  async search(request: {
    query: string;
    maxResults: number;
  }): Promise<{ provider: string; results: WebSearchResult[] }> {
    if (!this.apiKey) {
      throw new Error(
        "BRAVE_SEARCH_API_KEY is required for the brave provider.",
      );
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", request.query);
    url.searchParams.set("count", String(request.maxResults));

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Brave search failed with HTTP ${response.status}.`);
    }

    return {
      provider: this.name,
      results: normalizeBrave(await response.json()).slice(
        0,
        request.maxResults,
      ),
    };
  }

  async llmContext(request: LlmContextRequest): Promise<LlmContextResult> {
    if (!this.apiKey) {
      throw new Error(
        "BRAVE_SEARCH_API_KEY is required for the brave provider.",
      );
    }

    const url = new URL("https://api.search.brave.com/res/v1/llm/context");
    url.searchParams.set("q", request.query);
    if (request.maxTokens) {
      url.searchParams.set(
        "maximum_number_of_tokens",
        String(request.maxTokens),
      );
    }
    if (request.freshness) {
      url.searchParams.set("freshness", request.freshness);
    }

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Brave LLM Context search failed with HTTP ${response.status}.`,
      );
    }

    const payload = await response.json();
    return normalizeLlmContext(payload);
  }
}

const configSchema: ConfigSchema = {
  module: "brave",
  label: "Brave Search",
  fields: [
    {
      key: "webSearch.braveApiKey",
      label: "Brave Search API Key",
      description: "Your Brave Search API key",
      type: "string",
      required: true,
      secret: true,
    },
  ],
};

const module: WebSearchProviderModule = {
  metadata: {
    name: "brave",
    description: "Brave Search API provider.",
    version: "0.1.0",
  },
  configSchema,
  createProvider: (config) => {
    const ws = (config.webSearch ?? {}) as Record<string, unknown>;
    return new BraveSearchProvider(ws.braveApiKey as string | undefined);
  },
};

function normalizeBrave(payload: unknown): WebSearchResult[] {
  if (
    !isRecord(payload) || !isRecord(payload.web) ||
    !Array.isArray(payload.web.results)
  ) {
    return [];
  }

  return payload.web.results
    .filter(isRecord)
    .map((result) => ({
      title: stringValue(result.title) ?? "Untitled result",
      url: stringValue(result.url) ?? "",
      snippet: stringValue(result.description),
      publishedAt: stringValue(result.age),
    }))
    .filter((result) => result.url !== "");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function normalizeLlmContext(payload: unknown): LlmContextResult {
  if (!isRecord(payload)) {
    return { provider: "brave", context: "", sources: [] };
  }

  const grounding = isRecord(payload.grounding) ? payload.grounding : {};
  const generic = Array.isArray(grounding.generic) ? grounding.generic : [];
  const sourcesMap = isRecord(payload.sources) ? payload.sources : {};

  const snippets: string[] = [];
  const sources: { url: string; title: string; age?: string }[] = [];

  for (const entry of generic.filter(isRecord)) {
    const url = stringValue(entry.url) ?? "";
    const title = stringValue(entry.title) ?? "";
    const entrySnippets = Array.isArray(entry.snippets) ? entry.snippets : [];

    for (const snippet of entrySnippets) {
      if (typeof snippet === "string" && snippet.trim()) {
        snippets.push(snippet.trim());
      }
    }

    if (url) {
      const sourceInfo = isRecord(sourcesMap[url]) ? sourcesMap[url] : {};
      const age = Array.isArray(sourceInfo.age) && sourceInfo.age.length > 0
        ? String(sourceInfo.age[0])
        : undefined;
      sources.push({ url, title: title || stringValue(sourceInfo.title) || url, age });
    }
  }

  return {
    provider: "brave",
    context: snippets.join("\n\n"),
    sources,
  };
}

export default module;
