import { discoverWebSearchProviders } from "../../core/module-loader.ts";
import type {
  ConfigSchema,
  PluginModule,
  WebSearchProvider,
  WebSearchProviderResult,
} from "../../core/types.ts";
import { isRecord } from "../../core/helpers.ts";

interface WebSearchInput {
  query?: unknown;
  maxResults?: unknown;
  providers?: unknown;
}

const configSchema: ConfigSchema = {
  module: "web-search",
  label: "Web Search Plugin",
  fields: [
    {
      key: "webSearch.maxResults",
      label: "Max Results",
      description: "Default maximum number of search results to return",
      type: "number",
      required: false,
      default: 5,
    },
  ],
};

const module: PluginModule = {
  metadata: {
    name: "web-search",
    description: "Web search tool with dynamically loaded search providers.",
    version: "0.1.0",
  },
  configSchema,
  async setup(context) {
    const providers = new Map<string, WebSearchProvider>();
    const providerModules = await discoverWebSearchProviders(
      context.config.webSearchProvidersDir,
      context.config.webSearchProviderNames,
      context.logger.child("web-search"),
    );

    for (const providerModule of providerModules) {
      const provider = providerModule.createProvider(context.config.data);
      providers.set(provider.name, provider);
      context.logger.info(`Loaded web search provider ${provider.name}`);
    }

    context.tools.register({
      name: "web.search",
      description:
        'Search the web for current information. Input supports {"query":"...","maxResults":5,"providers":["duckduckgo","brave"]}.',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
          providers: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["query"],
      },
      async execute(input) {
        const parsed = parseInput(input);
        const maxResults = parsed.maxResults ??
          ((context.config.data.webSearch as Record<string, unknown>)?.maxResults as number) ?? 5;
        const providerNames = parsed.providers ?? [...providers.keys()];

        const settled = await Promise.allSettled(
          providerNames.map(async (providerName) => {
            const provider = providers.get(providerName);
            if (!provider) {
              throw new Error(`Unknown web search provider: ${providerName}`);
            }

            return await provider.search({
              query: parsed.query,
              maxResults,
            });
          }),
        );

        const results: WebSearchProviderResult[] = [];
        const errors: { provider: string; message: string }[] = [];

        for (const [index, item] of settled.entries()) {
          if (item.status === "fulfilled") {
            results.push(item.value);
          } else {
            errors.push({
              provider: providerNames[index],
              message: item.reason instanceof Error
                ? item.reason.message
                : String(item.reason),
            });
          }
        }

        const output = {
          query: parsed.query,
          results,
          errors,
        };

        console.log("[web-search] query:", parsed.query);
        console.log("[web-search] results:", JSON.stringify(output, null, 2));

        return output;
      },
    });

    // Register LLM Context tool if a provider supports it (e.g. Brave)
    const contextProvider = [...providers.values()].find((p) => p.llmContext);
    if (contextProvider) {
      context.tools.register({
        name: "web.context",
        description:
          'Search the web and get pre-extracted content for answering questions. Use this for current events, scores, stats, prices, news, or any factual query that needs up-to-date info. Input: {"query":"...","freshness":"pd|pw|pm|py"}. freshness is optional (pd=24h, pw=7d, pm=31d, py=365d).',
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            freshness: { type: "string" },
          },
          required: ["query"],
        },
        async execute(input) {
          if (!isRecord(input) || typeof input.query !== "string" || !input.query.trim()) {
            throw new Error('web.context expects {"query":"search terms"}.');
          }
          const query = (input.query as string).trim();
          const freshness = typeof input.freshness === "string"
            ? input.freshness.trim()
            : undefined;

          const result = await contextProvider.llmContext!({
            query,
            maxTokens: 8192,
            freshness,
          });

          return result;
        },
      });
    }
  },
};

function parseInput(input: unknown): {
  query: string;
  maxResults?: number;
  providers?: string[];
} {
  if (!isRecord(input)) {
    throw new Error('web.search expects input like {"query":"search terms"}.');
  }

  const rawInput = input as WebSearchInput;
  if (typeof rawInput.query !== "string") {
    throw new Error('web.search expects input like {"query":"search terms"}.');
  }

  const query = rawInput.query.trim();
  if (!query) {
    throw new Error("web.search query cannot be empty.");
  }

  const maxResults = typeof rawInput.maxResults === "number"
    ? clampMaxResults(rawInput.maxResults)
    : undefined;

  const providers = Array.isArray(rawInput.providers)
    ? rawInput.providers.filter((item: unknown): item is string =>
      typeof item === "string" && item.trim() !== ""
    )
    : undefined;

  return { query, maxResults, providers };
}

function clampMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.floor(value)));
}

export default module;
