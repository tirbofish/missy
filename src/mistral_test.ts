import { assertEquals } from "@std/assert";
import {
  buildLocalAttachmentFallback,
  buildUserChatContent,
  hasCurrentLocalFilesystemIntent,
  sendMistralMessage,
  shouldShowSourcesForRequest,
  shouldUseMistralWebSearch,
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

Deno.test("uses Mistral web search sparingly", () => {
  assertEquals(shouldUseMistralWebSearch("haha"), false);
  assertEquals(shouldUseMistralWebSearch("send a funny gif"), false);
  assertEquals(
    shouldUseMistralWebSearch("MISSY_GIF_SEARCH: awkward laugh reaction"),
    false,
  );
  assertEquals(shouldUseMistralWebSearch("what is a url"), false);
  assertEquals(shouldUseMistralWebSearch("who won the nba game tonight"), true);
  assertEquals(
    shouldUseMistralWebSearch("look up this page https://example.com"),
    true,
  );
  assertEquals(
    shouldUseMistralWebSearch("search online for the latest deno release"),
    true,
  );
});

Deno.test("local screenshot upload requests do not trigger web search", () => {
  assertEquals(
    shouldUseMistralWebSearch(
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
