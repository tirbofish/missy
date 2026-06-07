import { assertEquals } from "@std/assert";
import {
  buildLocalAttachmentFallback,
  buildUserChatContent,
  hasCurrentLocalFilesystemIntent,
  resolveMistralModelForPayload,
  sendMistralMessage,
  shouldShowSourcesForRequest,
  shouldUseWebSearch,
  splitDiscordMessages,
} from "./mistral.ts";

Deno.test("splits explicit message separators", () => {
  assertEquals(splitDiscordMessages("first\n---\nsecond"), [
    "first",
    "second",
  ]);
});

Deno.test("splits inline Missy message separators", () => {
  assertEquals(
    splitDiscordMessages("series is 2-0 knicks MISSY_MESSAGE_BREAK\nnext game"),
    [
      "series is 2-0 knicks",
      "next game",
    ],
  );
});

Deno.test("splits short casual multiline replies", () => {
  assertEquals(splitDiscordMessages("nah\nsame old missy, different day"), [
    "nah",
    "same old missy, different day",
  ]);
});

Deno.test("does not auto split lists", () => {
  const message = "- one\n- two";

  assertEquals(splitDiscordMessages(message), [message]);
});

Deno.test("detects explicit source requests", () => {
  assertEquals(shouldShowSourcesForRequest("who won the game"), false);
  assertEquals(shouldShowSourcesForRequest("is linux open source"), false);
  assertEquals(shouldShowSourcesForRequest("what is a url"), false);
  assertEquals(shouldShowSourcesForRequest("where did you find that"), true);
  assertEquals(shouldShowSourcesForRequest("where'd you read that"), true);
  assertEquals(shouldShowSourcesForRequest("link it"), true);
  assertEquals(shouldShowSourcesForRequest("send sources pls"), true);
});

Deno.test("uses web search sparingly", () => {
  assertEquals(shouldUseWebSearch("haha"), false);
  assertEquals(shouldUseWebSearch("send a funny gif"), false);
  assertEquals(
    shouldUseWebSearch("MISSY_GIF_SEARCH: awkward laugh reaction"),
    false,
  );
  assertEquals(shouldUseWebSearch("what is a url"), false);
  assertEquals(shouldUseWebSearch("who won the nba game tonight"), true);
  assertEquals(
    shouldUseWebSearch("look up this page https://example.com"),
    true,
  );
  assertEquals(
    shouldUseWebSearch("search online for the latest deno release"),
    true,
  );
  assertEquals(
    shouldUseWebSearch("find videos of the latest deno release"),
    true,
  );
  assertEquals(
    shouldUseWebSearch("show me images of the latest deno release"),
    true,
  );
});

Deno.test("local screenshot upload requests do not trigger web search", () => {
  assertEquals(
    shouldUseWebSearch(
      "go to my pictures folder and pick out a random screenshot, then embed into the discord chat",
    ),
    false,
  );
});

Deno.test("detects local screenshot upload filesystem intent", () => {
  assertEquals(
    hasCurrentLocalFilesystemIntent({
      message:
        "go to my pictures folder and pick out a random screenshot, then embed into the discord chat",
      source: "discord-server",
      discord: {
        userId: "1",
        username: "tester",
      },
    }),
    true,
  );
});

Deno.test("builds local attachment fallback from tool output paths", () => {
  const result = JSON.stringify({
    code: 0,
    stdout:
      "C:\\Users\\Thribhu\\Pictures\\Screenshots\\Screenshot 2026-06-06 222025.png\r\n",
    stderr: "",
  });

  assertEquals(
    buildLocalAttachmentFallback({
      message:
        "go to my pictures folder and pick out a random screenshot, then embed into the discord chat",
      source: "discord-server",
      discord: {
        userId: "1",
        username: "tester",
      },
    }, [result]),
    "MISSY_ATTACH_LOCAL: C:\\Users\\Thribhu\\Pictures\\Screenshots\\Screenshot 2026-06-06 222025.png",
  );
});

Deno.test("builds vision chat content with image url blocks", () => {
  assertEquals(
    buildUserChatContent({
      imageUrls: ["https://cdn.example/image.png"],
      message: "what is this?",
    }),
    [
      {
        type: "text",
        text: "what is this?",
      },
      {
        type: "image_url",
        image_url: "https://cdn.example/image.png",
      },
    ],
  );
});

Deno.test("routes image payloads through chat completions vision content", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((url: URL | Request | string, init?: RequestInit) => {
    const requestUrl = new URL(url.toString());
    assertEquals(requestUrl.href, "https://api.mistral.ai/v1/chat/completions");

    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
      tools?: unknown[];
    };
    const userMessage = body.messages.at(-1);

    assertEquals(userMessage?.role, "user");
    assertEquals(userMessage?.content, [
      {
        type: "text",
        text: "what is this image?",
      },
      {
        type: "image_url",
        image_url: "https://cdn.example/image.png",
      },
    ]);
    assertEquals(body.tools, undefined);

    return Promise.resolve(
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: "looks like a test image",
          },
        }],
      })),
    );
  }) as typeof fetch;

  try {
    const reply = await sendMistralMessage("test-key", {
      imageUrls: ["https://cdn.example/image.png"],
      message: "what is this image?",
      source: "discord-dm",
      discord: {
        userId: "1",
        username: "tester",
      },
    }, {
      enableMcp: false,
      model: "mistral-small-latest",
      personalityInstruction: "You are Missy.",
    });

    assertEquals(reply, "looks like a test image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("exposes Brave tools for web search requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  const originalEnableSearch = Deno.env.get("BRAVE_ENABLE_SEARCH");
  const originalUseConversations = Deno.env.get("MISTRAL_USE_CONVERSATIONS");

  Deno.env.set("BRAVE_SEARCH_API_KEY", "test-brave-key");
  Deno.env.delete("BRAVE_ENABLE_SEARCH");
  Deno.env.delete("MISTRAL_USE_CONVERSATIONS");

  globalThis.fetch = ((url: URL | Request | string, init?: RequestInit) => {
    const requestUrl = new URL(url.toString());
    assertEquals(requestUrl.href, "https://api.mistral.ai/v1/chat/completions");

    const body = JSON.parse(String(init?.body)) as {
      tools?: Array<{ type: string; function?: { name?: string } }>;
    };

    assertEquals(
      body.tools?.map((tool) => tool.function?.name),
      [
        "missy_brave_web_search",
        "missy_brave_image_search",
        "missy_brave_video_search",
        "missy_brave_news_search",
      ],
    );
    assertEquals(body.tools?.every((tool) => tool.type === "function"), true);

    return Promise.resolve(
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: "Deno has a current release.",
          },
        }],
      })),
    );
  }) as typeof fetch;

  try {
    const reply = await sendMistralMessage("test-key", {
      message: "search online for the latest deno release",
      source: "discord-dm",
      discord: {
        userId: "1",
        username: "tester",
      },
    }, {
      enableMcp: false,
      model: "mistral-small-latest",
      personalityInstruction: "You are Missy.",
    });

    assertEquals(reply, "Deno has a current release.");
  } finally {
    globalThis.fetch = originalFetch;

    if (originalKey === undefined) {
      Deno.env.delete("BRAVE_SEARCH_API_KEY");
    } else {
      Deno.env.set("BRAVE_SEARCH_API_KEY", originalKey);
    }

    if (originalEnableSearch === undefined) {
      Deno.env.delete("BRAVE_ENABLE_SEARCH");
    } else {
      Deno.env.set("BRAVE_ENABLE_SEARCH", originalEnableSearch);
    }

    if (originalUseConversations === undefined) {
      Deno.env.delete("MISTRAL_USE_CONVERSATIONS");
    } else {
      Deno.env.set("MISTRAL_USE_CONVERSATIONS", originalUseConversations);
    }
  }
});

Deno.test("router mode picks configured models by request shape", () => {
  const previous = {
    fast: Deno.env.get("MISTRAL_ROUTER_FAST_MODEL"),
    general: Deno.env.get("MISTRAL_ROUTER_GENERAL_MODEL"),
    reasoning: Deno.env.get("MISTRAL_ROUTER_REASONING_MODEL"),
    tool: Deno.env.get("MISTRAL_ROUTER_TOOL_MODEL"),
    vision: Deno.env.get("MISTRAL_ROUTER_VISION_MODEL"),
  };

  Deno.env.set("MISTRAL_ROUTER_FAST_MODEL", "router-fast");
  Deno.env.set("MISTRAL_ROUTER_GENERAL_MODEL", "router-general");
  Deno.env.set("MISTRAL_ROUTER_REASONING_MODEL", "router-reasoning");
  Deno.env.set("MISTRAL_ROUTER_TOOL_MODEL", "router-tool");
  Deno.env.set("MISTRAL_ROUTER_VISION_MODEL", "router-vision");

  const basePayload = {
    source: "discord-dm" as const,
    discord: {
      userId: "1",
      username: "tester",
    },
  };

  try {
    assertEquals(
      resolveMistralModelForPayload({
        ...basePayload,
        message: "thanks",
      }, { model: "router" }),
      "router-fast",
    );
    assertEquals(
      resolveMistralModelForPayload({
        ...basePayload,
        message: "what makes sourdough rise?",
      }, { model: "router" }),
      "router-general",
    );
    assertEquals(
      resolveMistralModelForPayload({
        ...basePayload,
        message: "debug this TypeScript stack trace and explain the root cause",
      }, { model: "router" }),
      "router-reasoning",
    );
    assertEquals(
      resolveMistralModelForPayload({
        ...basePayload,
        message: "search online for the latest deno release",
      }, { model: "router" }),
      "router-tool",
    );
    assertEquals(
      resolveMistralModelForPayload({
        ...basePayload,
        imageUrls: ["https://cdn.example/image.png"],
        message: "what is this image?",
      }, { model: "router" }),
      "router-vision",
    );
  } finally {
    for (
      const [key, value] of Object.entries({
        MISTRAL_ROUTER_FAST_MODEL: previous.fast,
        MISTRAL_ROUTER_GENERAL_MODEL: previous.general,
        MISTRAL_ROUTER_REASONING_MODEL: previous.reasoning,
        MISTRAL_ROUTER_TOOL_MODEL: previous.tool,
        MISTRAL_ROUTER_VISION_MODEL: previous.vision,
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

Deno.test("non-router model bypasses router mode", () => {
  assertEquals(
    resolveMistralModelForPayload({
      message: "debug this TypeScript stack trace",
      source: "discord-dm",
      discord: {
        userId: "1",
        username: "tester",
      },
    }, { model: "mistral-small-latest" }),
    "mistral-small-latest",
  );
});
