import { assertEquals } from "@std/assert";
import { searchGiphyGif } from "./giphy.ts";

Deno.test("searches GIPHY with expected parameters", async () => {
  const gifUrl = await searchGiphyGif("dry laugh", {
    apiKey: "test-key",
    fetcher: ((url: URL | Request | string) => {
      const requestUrl = new URL(url.toString());

      assertEquals(requestUrl.href.startsWith("https://api.giphy.com/"), true);
      assertEquals(requestUrl.searchParams.get("api_key"), "test-key");
      assertEquals(requestUrl.searchParams.get("q"), "dry laugh");
      assertEquals(requestUrl.searchParams.get("limit"), "10");
      assertEquals(requestUrl.searchParams.get("rating"), "pg-13");
      assertEquals(requestUrl.searchParams.get("lang"), "en");

      return Promise.resolve(
        new Response(JSON.stringify({
          data: [{
            images: {
              downsized: { url: "https://media.giphy.com/media/a/giphy.gif" },
            },
          }],
        })),
      );
    }) as typeof fetch,
  });

  assertEquals(gifUrl, "https://media.giphy.com/media/a/giphy.gif");
});

Deno.test("does not call GIPHY without an API key or query", async () => {
  let called = false;
  const fetcher = (() => {
    called = true;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;

  assertEquals(await searchGiphyGif("dry laugh", { fetcher }), undefined);
  assertEquals(
    await searchGiphyGif("", { apiKey: "test-key", fetcher }),
    undefined,
  );
  assertEquals(called, false);
});
