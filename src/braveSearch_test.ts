import { assertEquals, assertRejects } from "@std/assert";
import { BRAVE_SEARCH_TOOL_NAMES, callBraveSearchTool } from "./braveSearch.ts";

Deno.test("calls Brave web search with expected endpoint and headers", async () => {
  const result = await callBraveSearchTool(
    BRAVE_SEARCH_TOOL_NAMES.web,
    {
      count: 30,
      country: "AU",
      freshness: "pw",
      query: "latest deno release",
      resultFilter: ["web", "news"],
      searchLang: "en",
    },
    {
      apiKey: "test-brave-key",
      fetcher: (url: URL | Request | string, init?: RequestInit) => {
        const requestUrl = new URL(url.toString());

        assertEquals(
          requestUrl.href,
          "https://api.search.brave.com/res/v1/web/search?q=latest+deno+release&count=20&country=AU&search_lang=en&freshness=pw&ui_lang=en-US&result_filter=web%2Cnews",
        );
        assertEquals(
          init?.headers,
          {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": "test-brave-key",
          },
        );

        return Promise.resolve(
          new Response(JSON.stringify({
            type: "search",
            query: { original: "latest deno release" },
            web: {
              results: [{
                title: "Deno 2.5",
                url: "https://deno.com/blog",
                description: "Release notes",
                age: "1 day ago",
              }],
            },
          })),
        );
      },
    },
  );

  assertEquals(
    JSON.parse(result),
    {
      type: "search",
      query: { original: "latest deno release" },
      discussions: [],
      faq: [],
      locations: [],
      news: [],
      videos: [],
      web: [{
        title: "Deno 2.5",
        url: "https://deno.com/blog",
        description: "Release notes",
        age: "1 day ago",
      }],
    },
  );
});

Deno.test("calls Brave image search and compacts image results", async () => {
  const result = await callBraveSearchTool(
    BRAVE_SEARCH_TOOL_NAMES.images,
    { count: 500, query: "black myth wukong" },
    {
      apiKey: "test-brave-key",
      fetcher: (url: URL | Request | string) => {
        const requestUrl = new URL(url.toString());

        assertEquals(
          requestUrl.href,
          "https://api.search.brave.com/res/v1/images/search?q=black+myth+wukong&count=200&country=US&search_lang=en",
        );

        return Promise.resolve(
          new Response(JSON.stringify({
            type: "images",
            query: { original: "black myth wukong" },
            results: [{
              title: "Black Myth Wukong image",
              url: "https://example.com/page",
              thumbnail: { src: "https://example.com/thumb.jpg" },
              properties: { url: "https://example.com/image.jpg" },
            }],
          })),
        );
      },
    },
  );

  assertEquals(
    JSON.parse(result),
    {
      type: "images",
      query: { original: "black myth wukong" },
      results: [{
        title: "Black Myth Wukong image",
        url: "https://example.com/page",
        thumbnail: "https://example.com/thumb.jpg",
        imageUrl: "https://example.com/image.jpg",
      }],
    },
  );
});

Deno.test("requires Brave Search API key", async () => {
  await assertRejects(
    () =>
      callBraveSearchTool(
        BRAVE_SEARCH_TOOL_NAMES.videos,
        { query: "machine learning tutorial" },
        { apiKey: "" },
      ),
    Error,
    "BRAVE_SEARCH_API_KEY is not set.",
  );
});
