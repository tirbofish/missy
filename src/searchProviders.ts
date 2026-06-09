import {
  braveSearchTools,
  callBraveSearchTool,
  hasBraveSearchApiKey,
  isBraveSearchTool,
} from "./braveSearch.ts";
import { MistralToolDefinition } from "./mcp.ts";

export type SearchProvider = {
  id: string;
  displayName: string;
  tools: MistralToolDefinition[];
  available: () => boolean;
  enabled: () => boolean;
  isTool: (toolName: string) => boolean;
  callTool: (toolName: string, rawArguments: unknown) => Promise<string>;
  toolInstruction: string;
  unavailableInstruction: string;
};

const braveSearchProvider: SearchProvider = {
  id: "brave",
  displayName: "Brave Search",
  tools: braveSearchTools,
  available: hasBraveSearchApiKey,
  enabled: () => (Deno.env.get("BRAVE_ENABLE_SEARCH") ?? "1") !== "0",
  isTool: isBraveSearchTool,
  callTool: callBraveSearchTool,
  toolInstruction:
    "You have web search tools for this request because the user asked for current, live, recent, specific web/page, image search, or video search information. Use missy_brave_web_search for normal web lookups, missy_brave_image_search for online image/photo searches, missy_brave_video_search for online video searches, and missy_brave_news_search for recent news. Never answer with only a waiting/checking message; if you use a search tool, provide the actual answer in this same response. CRITICAL: Never fabricate specific numbers (temperatures, scores, prices, statistics) that are not explicitly present in the search results. If search results only contain links or page descriptions without the actual data you need, honestly tell the user the search didn't give you the answer - do not guess or invent values.",
  unavailableInstruction:
    "The user asked for web search, but BRAVE_SEARCH_API_KEY is not configured. Do not claim you searched the web.",
};

const HTTP_JSON_SEARCH_TOOL_NAME = "missy_http_json_search";

function httpJsonSearchUrl(): string | undefined {
  return Deno.env.get("MISSY_SEARCH_HTTP_URL")?.trim();
}

const httpJsonSearchProvider: SearchProvider = {
  id: "http-json",
  displayName: "HTTP JSON search",
  tools: [
    {
      type: "function",
      function: {
        name: HTTP_JSON_SEARCH_TOOL_NAME,
        description:
          "Search through the configured HTTP JSON search provider for current web, image, video, or news lookup requests.",
        parameters: {
          type: "object",
          properties: {
            count: {
              type: "integer",
              description: "Maximum results to return. Defaults to 5.",
            },
            freshness: {
              type: "string",
              description:
                "Optional freshness filter such as day, week, month, or a provider-specific range.",
            },
            kind: {
              type: "string",
              description: "Search vertical.",
              enum: ["web", "images", "videos", "news"],
            },
            query: {
              type: "string",
              description: "Search query. Keep it focused.",
            },
          },
          required: ["query"],
        },
      },
    },
  ],
  available: () => Boolean(httpJsonSearchUrl()),
  enabled: () => true,
  isTool: (toolName) => toolName === HTTP_JSON_SEARCH_TOOL_NAME,
  callTool: async (_toolName, rawArguments) => {
    const url = httpJsonSearchUrl();

    if (!url) {
      throw new Error(
        "MISSY_SEARCH_HTTP_URL is required when MISSY_SEARCH_PROVIDER=http-json.",
      );
    }

    const args = typeof rawArguments === "string"
      ? JSON.parse(rawArguments || "{}") as Record<string, unknown>
      : rawArguments && typeof rawArguments === "object"
      ? rawArguments as Record<string, unknown>
      : {};
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = Deno.env.get("MISSY_SEARCH_HTTP_API_KEY")?.trim();

    if (apiKey) {
      const headerName =
        Deno.env.get("MISSY_SEARCH_HTTP_AUTH_HEADER")?.trim() ||
        "Authorization";
      const prefix = Deno.env.get("MISSY_SEARCH_HTTP_AUTH_PREFIX") ?? "Bearer ";
      headers[headerName] = `${prefix}${apiKey}`;
    }

    const response = await fetch(url, {
      body: JSON.stringify(args),
      headers,
      method: "POST",
    });
    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP JSON search provider returned HTTP ${response.status}: ${responseBody}`,
      );
    }

    return responseBody;
  },
  toolInstruction:
    "You have web search tools for this request because the user asked for current, live, recent, specific web/page, image search, or video search information. Use missy_http_json_search for web, image, video, or news lookups through the configured search provider. Never answer with only a waiting/checking message; if you use a search tool, provide the actual answer in this same response. CRITICAL: Never fabricate specific numbers (temperatures, scores, prices, statistics) that are not explicitly present in the search results.",
  unavailableInstruction:
    "The user asked for web search, but MISSY_SEARCH_HTTP_URL is not configured. Do not claim you searched the web.",
};

const providers: Record<string, SearchProvider> = {
  brave: braveSearchProvider,
  "http-json": httpJsonSearchProvider,
};

export function configuredSearchProviderId(): string {
  return (Deno.env.get("MISSY_SEARCH_PROVIDER") ?? "brave").trim()
    .toLowerCase();
}

export function activeSearchProvider(): SearchProvider | undefined {
  const providerId = configuredSearchProviderId();

  if (providerId === "none" || providerId === "off" || providerId === "0") {
    return undefined;
  }

  return providers[providerId];
}

export function configuredSearchProviderLabel(): string {
  return activeSearchProvider()?.displayName ?? configuredSearchProviderId();
}
