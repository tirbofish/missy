import { assertEquals } from "@std/assert";
import { sendModelMessage } from "./modelProviders.ts";

Deno.test("openai-compatible provider uses configured chat completions endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = Deno.env.get("MISSY_MODEL_PROVIDER");
  const previousUrl = Deno.env.get(
    "MISSY_OPENAI_COMPATIBLE_CHAT_COMPLETIONS_URL",
  );
  const previousModel = Deno.env.get("MISSY_MODEL");

  Deno.env.set("MISSY_MODEL_PROVIDER", "openai-compatible");
  Deno.env.set(
    "MISSY_OPENAI_COMPATIBLE_CHAT_COMPLETIONS_URL",
    "https://llm.example.test/v1/chat/completions",
  );
  Deno.env.set("MISSY_MODEL", "provider-model");

  globalThis.fetch = ((url: URL | Request | string, init?: RequestInit) => {
    const requestUrl = new URL(url.toString());
    assertEquals(
      requestUrl.href,
      "https://llm.example.test/v1/chat/completions",
    );

    const body = JSON.parse(String(init?.body)) as { model?: string };
    assertEquals(body.model, "provider-model");

    return Promise.resolve(
      new Response(JSON.stringify({
        choices: [{ message: { content: "provider reply" } }],
      })),
    );
  }) as typeof fetch;

  try {
    const reply = await sendModelMessage("test-key", {
      message: "hello",
      source: "discord-dm",
      discord: {
        userId: "1",
        username: "tester",
      },
    }, {
      enableMcp: false,
      personalityInstruction: "You are Missy.",
    });

    assertEquals(reply, "provider reply");
  } finally {
    globalThis.fetch = originalFetch;

    for (
      const [key, value] of Object.entries({
        MISSY_MODEL_PROVIDER: previousProvider,
        MISSY_MODEL: previousModel,
        MISSY_OPENAI_COMPATIBLE_CHAT_COMPLETIONS_URL: previousUrl,
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
