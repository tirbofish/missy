import { assertEquals, assertRejects } from "@std/assert";
import { MistralApiError } from "./mistral/mod.ts";
import {
  formatMistralModelStatus,
  listMistralModels,
} from "./mistralStatus.ts";

Deno.test("lists Mistral models with expected endpoint and auth", async () => {
  const models = await listMistralModels("test-key", {
    fetcher: ((url: URL | Request | string, init?: RequestInit) => {
      assertEquals(url.toString(), "https://api.mistral.ai/v1/models");
      assertEquals(init?.method, "GET");
      assertEquals(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-key",
      );

      return Promise.resolve(
        new Response(JSON.stringify({
          data: [
            {
              id: "mistral-small-latest",
              capabilities: {
                completion_chat: true,
                function_calling: true,
                vision: true,
              },
              max_context_length: 128000,
            },
          ],
        })),
      );
    }) as typeof fetch,
  });

  assertEquals(models, [
    {
      id: "mistral-small-latest",
      capabilities: {
        completion_chat: true,
        function_calling: true,
        vision: true,
      },
      max_context_length: 128000,
    },
  ]);
});

Deno.test("accepts array-shaped Mistral models responses", async () => {
  const models = await listMistralModels("test-key", {
    fetcher: (() =>
      Promise.resolve(
        new Response(JSON.stringify([
          { id: "z-model" },
          { id: "a-model" },
        ])),
      )) as typeof fetch,
  });

  assertEquals(models.map((model) => model.id), ["a-model", "z-model"]);
});

Deno.test("throws MistralApiError for failed models status", async () => {
  await assertRejects(
    () =>
      listMistralModels("bad-key", {
        fetcher: (() =>
          Promise.resolve(
            new Response("Unauthorized", { status: 401 }),
          )) as typeof fetch,
      }),
    MistralApiError,
    "Mistral Models API returned HTTP 401",
  );
});

Deno.test("formats Mistral model availability status", () => {
  assertEquals(
    formatMistralModelStatus([
      {
        aliases: ["mistral-small-latest"],
        capabilities: {
          completion_chat: true,
          function_calling: true,
          vision: true,
        },
        id: "mistral-small-2506",
        max_context_length: 128000,
      },
      {
        archived: true,
        capabilities: {
          completion_fim: true,
        },
        id: "codestral-legacy",
      },
    ], "mistral-small-latest"),
    [
      "Mistral model status",
      "Current model: mistral-small-latest (available)",
      "Available models for this API key: 2",
      "",
      "available: mistral-small-2506 - chat, tools, vision; ctx 128,000 aliases: mistral-small-latest",
      "available: codestral-legacy - fim; archived",
    ].join("\n"),
  );
});

Deno.test("formats router model status as pseudo-model", () => {
  assertEquals(
    formatMistralModelStatus([
      {
        capabilities: {
          completion_chat: true,
        },
        id: "mistral-small-latest",
      },
    ], "router"),
    [
      "Mistral model status",
      "Current model: router (router mode)",
      "Available models for this API key: 1",
      "",
      "Router mode resolves to a concrete model per request before calling Mistral.",
      "",
      "available: mistral-small-latest - chat",
    ].join("\n"),
  );
});
