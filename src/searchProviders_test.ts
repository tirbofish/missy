import { assertEquals } from "@std/assert";
import { activeSearchProvider } from "./searchProviders.ts";

Deno.test("http-json search provider posts to configured endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = Deno.env.get("MISSY_SEARCH_PROVIDER");
  const previousUrl = Deno.env.get("MISSY_SEARCH_HTTP_URL");
  const previousKey = Deno.env.get("MISSY_SEARCH_HTTP_API_KEY");

  Deno.env.set("MISSY_SEARCH_PROVIDER", "http-json");
  Deno.env.set("MISSY_SEARCH_HTTP_URL", "https://search.example.test/query");
  Deno.env.set("MISSY_SEARCH_HTTP_API_KEY", "test-search-key");

  globalThis.fetch = ((url: URL | Request | string, init?: RequestInit) => {
    const requestUrl = new URL(url.toString());
    assertEquals(requestUrl.href, "https://search.example.test/query");
    assertEquals(
      (init?.headers as Record<string, string>)?.Authorization,
      "Bearer test-search-key",
    );
    assertEquals(JSON.parse(String(init?.body)), {
      kind: "web",
      query: "latest deno release",
    });

    return Promise.resolve(
      new Response(JSON.stringify({
        results: [{ title: "Deno release", url: "https://deno.com" }],
      })),
    );
  }) as typeof fetch;

  try {
    const provider = activeSearchProvider();
    assertEquals(provider?.id, "http-json");
    assertEquals(provider?.available(), true);
    assertEquals(provider?.isTool("missy_http_json_search"), true);
    assertEquals(
      await provider?.callTool("missy_http_json_search", {
        kind: "web",
        query: "latest deno release",
      }),
      JSON.stringify({
        results: [{ title: "Deno release", url: "https://deno.com" }],
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;

    for (
      const [key, value] of Object.entries({
        MISSY_SEARCH_HTTP_API_KEY: previousKey,
        MISSY_SEARCH_HTTP_URL: previousUrl,
        MISSY_SEARCH_PROVIDER: previousProvider,
      })
    ) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
});
