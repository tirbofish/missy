import { assertEquals, assertRejects } from "@std/assert";
import { BRAVE_SEARCH_TOOL_NAMES, callBraveSearchTool } from "./braveSearch.ts";

Deno.test("calls Brave web search using LLM Context with rich callback", async () => {
  const calls: string[] = [];

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
        calls.push(requestUrl.pathname);

        assertEquals(
          init?.headers,
          {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": "test-brave-key",
          },
        );

        if (requestUrl.pathname === "/res/v1/llm/context") {
          assertEquals(requestUrl.searchParams.get("q"), "latest deno release");
          assertEquals(requestUrl.searchParams.get("count"), "20");
          assertEquals(requestUrl.searchParams.get("country"), "AU");
          assertEquals(requestUrl.searchParams.get("search_lang"), "en");
          assertEquals(requestUrl.searchParams.get("freshness"), "pw");

          return Promise.resolve(
            new Response(JSON.stringify({
              grounding: {
                generic: [{
                  url: "https://deno.com/blog",
                  title: "Deno 2.5",
                  snippets: ["Deno 2.5 has been released with new features."],
                }],
              },
              sources: {
                "https://deno.com/blog": {
                  title: "Deno 2.5",
                  hostname: "deno.com",
                  age: ["1 day ago"],
                },
              },
            })),
          );
        }

        if (requestUrl.pathname === "/res/v1/web/search") {
          assertEquals(requestUrl.searchParams.get("enable_rich_callback"), "1");

          return Promise.resolve(
            new Response(JSON.stringify({
              type: "search",
              query: { original: "latest deno release" },
            })),
          );
        }

        return Promise.resolve(new Response("{}", { status: 404 }));
      },
    },
  );

  assertEquals(calls.includes("/res/v1/llm/context"), true);
  assertEquals(calls.includes("/res/v1/web/search"), true);

  const parsed = JSON.parse(result);
  assertEquals(parsed.grounding.generic[0].title, "Deno 2.5");
  assertEquals(
    parsed.grounding.generic[0].snippets[0],
    "Deno 2.5 has been released with new features.",
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
