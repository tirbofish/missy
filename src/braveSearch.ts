import { MistralToolDefinition } from "./mcp.ts";

const BRAVE_SEARCH_API_BASE_URL = "https://api.search.brave.com/res/v1";
const DEFAULT_COUNTRY = "US";
const DEFAULT_SEARCH_LANG = "en";
const DEFAULT_UI_LANG = "en-US";

export const BRAVE_SEARCH_TOOL_NAMES = {
  images: "missy_brave_image_search",
  news: "missy_brave_news_search",
  videos: "missy_brave_video_search",
  web: "missy_brave_web_search",
} as const;

type BraveSearchKind = keyof typeof BRAVE_SEARCH_TOOL_NAMES;

type Fetcher = typeof fetch;

export type BraveSearchOptions = {
  apiKey?: string;
  fetcher?: Fetcher;
};

const endpointByKind: Record<BraveSearchKind, string> = {
  images: "/images/search",
  news: "/news/search",
  videos: "/videos/search",
  web: "/web/search",
};

const maxCountByKind: Record<BraveSearchKind, number> = {
  images: 200,
  news: 50,
  videos: 50,
  web: 20,
};

function braveSearchApiKey(
  options: BraveSearchOptions = {},
): string | undefined {
  return options.apiKey ?? Deno.env.get("BRAVE_SEARCH_API_KEY")?.trim();
}

export function hasBraveSearchApiKey(): boolean {
  return Boolean(braveSearchApiKey());
}

function commonProperties(maxCount: number): Record<string, unknown> {
  return {
    count: {
      type: "integer",
      description:
        `Maximum results to return. Defaults to 10. Max ${maxCount}.`,
    },
    country: {
      type: "string",
      description:
        "Two-letter search country code such as US or AU. Use ALL for worldwide where Brave supports it.",
    },
    query: {
      type: "string",
      description: "Search query. Keep it focused and under 400 characters.",
    },
    safesearch: {
      type: "string",
      description: "Safe search mode.",
      enum: ["off", "moderate", "strict"],
    },
    searchLang: {
      type: "string",
      description: "Search language code such as en.",
    },
    spellcheck: {
      type: "boolean",
      description:
        "Whether Brave should spellcheck the query. Defaults to true.",
    },
  };
}

function freshnessProperty(): Record<string, unknown> {
  return {
    freshness: {
      type: "string",
      description:
        "Optional freshness filter: pd for past day, pw for past week, pm for past month, py for past year, or YYYY-MM-DDtoYYYY-MM-DD.",
    },
  };
}

function searchTool(
  kind: BraveSearchKind,
  description: string,
  extraProperties: Record<string, unknown> = {},
): MistralToolDefinition {
  return {
    type: "function",
    function: {
      name: BRAVE_SEARCH_TOOL_NAMES[kind],
      description,
      parameters: {
        type: "object",
        properties: {
          ...commonProperties(maxCountByKind[kind]),
          ...extraProperties,
        },
        required: ["query"],
      },
    },
  };
}

export const braveSearchTools: MistralToolDefinition[] = [
  searchTool(
    "web",
    "Search the web with Brave Search for current, factual, page, URL, source, or general online lookup requests. Prefer this for normal web searches.",
    {
      resultFilter: {
        type: "array",
        description:
          "Optional Brave result filters for web search, such as web, news, videos, discussions, faq, infobox, locations.",
        items: { type: "string" },
      },
      ...freshnessProperty(),
    },
  ),
  searchTool(
    "images",
    "Search images with Brave Image Search when the user asks to find online images, photos, pictures, thumbnails, visual references, or image URLs.",
  ),
  searchTool(
    "videos",
    "Search videos with Brave Video Search when the user asks to find online videos, clips, tutorials, trailers, or video URLs.",
    freshnessProperty(),
  ),
  searchTool(
    "news",
    "Search news with Brave News Search when the user asks for recent news, reporting, announcements, or current events.",
    freshnessProperty(),
  ),
];

export function isBraveSearchTool(toolName: string): boolean {
  return Object.values(BRAVE_SEARCH_TOOL_NAMES).includes(
    toolName as typeof BRAVE_SEARCH_TOOL_NAMES[
      keyof typeof BRAVE_SEARCH_TOOL_NAMES
    ],
  );
}

function kindFromToolName(toolName: string): BraveSearchKind {
  for (const [kind, name] of Object.entries(BRAVE_SEARCH_TOOL_NAMES)) {
    if (name === toolName) {
      return kind as BraveSearchKind;
    }
  }

  throw new Error(`Unknown Brave Search tool: ${toolName}`);
}

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function requiredQuery(args: Record<string, unknown>): string {
  const query = String(args.query ?? args.q ?? "").trim();

  if (!query) {
    throw new Error("query is required.");
  }

  return query.slice(0, 400);
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function addOptionalParam(
  url: URL,
  name: string,
  value: string | boolean | undefined,
): void {
  if (value === undefined || value === "") {
    return;
  }

  url.searchParams.set(name, String(value));
}

function addCommonParams(
  url: URL,
  kind: BraveSearchKind,
  args: Record<string, unknown>,
): void {
  url.searchParams.set("q", requiredQuery(args));
  url.searchParams.set(
    "count",
    String(boundedInteger(args.count, 10, maxCountByKind[kind])),
  );
  url.searchParams.set(
    "country",
    optionalString(args.country) ?? Deno.env.get("BRAVE_SEARCH_COUNTRY") ??
      DEFAULT_COUNTRY,
  );
  url.searchParams.set(
    "search_lang",
    optionalString(args.searchLang) ?? Deno.env.get("BRAVE_SEARCH_LANG") ??
      DEFAULT_SEARCH_LANG,
  );
  addOptionalParam(url, "spellcheck", optionalBoolean(args.spellcheck));
  addOptionalParam(url, "safesearch", optionalString(args.safesearch));
  addOptionalParam(url, "freshness", optionalString(args.freshness));

  if (kind === "web" || kind === "videos" || kind === "news") {
    url.searchParams.set(
      "ui_lang",
      optionalString(args.uiLang) ?? Deno.env.get("BRAVE_SEARCH_UI_LANG") ??
        DEFAULT_UI_LANG,
    );
  }

  if (kind === "web" && Array.isArray(args.resultFilter)) {
    const resultFilter = args.resultFilter
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .join(",");

    addOptionalParam(url, "result_filter", resultFilter);
  }
}

function scalar(value: unknown): string | number | boolean | undefined {
  return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ? value
    : undefined;
}

function nestedScalar(
  value: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | number | boolean | undefined {
  const nested = value[key];

  if (!nested || typeof nested !== "object") {
    return undefined;
  }

  return scalar((nested as Record<string, unknown>)[nestedKey]);
}

function serializeResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result = value as Record<string, unknown>;
  return Object.fromEntries(
    [
      ["title", scalar(result.title)],
      ["url", scalar(result.url)],
      ["description", scalar(result.description)],
      ["age", scalar(result.age)],
      ["pageAge", scalar(result.page_age)],
      [
        "source",
        scalar(result.source) ?? nestedScalar(result, "profile", "name"),
      ],
      [
        "thumbnail",
        scalar(result.thumbnail) ?? nestedScalar(result, "thumbnail", "src"),
      ],
      [
        "imageUrl",
        scalar(result.image_url) ?? nestedScalar(result, "properties", "url"),
      ],
      ["duration", scalar(result.duration)],
      ["publisher", scalar(result.publisher)],
      ["published", scalar(result.published) ?? scalar(result.date)],
    ].filter(([, entryValue]) => entryValue !== undefined),
  );
}

function resultList(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const section = value as { results?: unknown };
  return Array.isArray(section.results)
    ? section.results.map(serializeResult).filter((result) =>
      Object.keys(result).length > 0
    )
    : [];
}

function compactResponse(kind: BraveSearchKind, parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const response = parsed as Record<string, unknown>;
  const query = response.query;
  const common = {
    query,
    type: response.type,
  };

  if (Array.isArray(response.results)) {
    return {
      ...common,
      results: response.results.map(serializeResult).filter((result) =>
        Object.keys(result).length > 0
      ),
    };
  }

  if (kind !== "web") {
    return common;
  }

  return {
    ...common,
    discussions: resultList(response.discussions),
    faq: resultList(response.faq),
    infobox: response.infobox,
    locations: resultList(response.locations),
    news: resultList(response.news),
    videos: resultList(response.videos),
    web: resultList(response.web),
  };
}

export async function callBraveSearchTool(
  toolName: string,
  rawArguments: unknown,
  options: BraveSearchOptions = {},
): Promise<string> {
  const kind = kindFromToolName(toolName);
  const apiKey = braveSearchApiKey(options);

  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_API_KEY is not set.");
  }

  const args = parseArgs(rawArguments);
  const url = new URL(`${BRAVE_SEARCH_API_BASE_URL}${endpointByKind[kind]}`);
  addCommonParams(url, kind, args);

  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Brave Search API returned HTTP ${response.status}: ${responseBody}`,
    );
  }

  return JSON.stringify(compactResponse(kind, JSON.parse(responseBody)));
}
