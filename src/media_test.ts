import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  classifyMediaAttachment,
  formatMediaAttachments,
  summarizeAssistantMediaContent,
  visionImageUrls,
} from "./media.ts";

Deno.test("classifies image and gif attachments", () => {
  assertEquals(
    classifyMediaAttachment({
      contentType: "image/png",
      url: "https://cdn.example/image",
    }),
    "image",
  );
  assertEquals(
    classifyMediaAttachment({
      contentType: "image/gif",
      url: "https://cdn.example/animation",
    }),
    "gif",
  );
  assertEquals(
    classifyMediaAttachment({
      url: "https://cdn.example/animation.gif",
    }),
    "gif",
  );
});

Deno.test("formats media attachments for model input", () => {
  const formatted = formatMediaAttachments([
    {
      contentType: "image/gif",
      name: "cat.gif",
      size: 2048,
      url: "https://cdn.example/cat.gif",
    },
  ]);

  assertStringIncludes(formatted ?? "", "gif");
  assertStringIncludes(formatted ?? "", "cat.gif");
  assertStringIncludes(formatted ?? "", "2.0 KB");
  assertStringIncludes(formatted ?? "", "https://cdn.example/cat.gif");
});

Deno.test("extracts vision image urls from image attachments only", () => {
  assertEquals(
    visionImageUrls([
      {
        contentType: "image/png",
        url: "https://cdn.example/image.png",
      },
      {
        contentType: "image/gif",
        url: "https://cdn.example/animation.gif",
      },
      {
        contentType: "video/mp4",
        url: "https://cdn.example/video.mp4",
      },
    ]),
    ["https://cdn.example/image.png"],
  );
});

Deno.test("summarizes assistant gif replies without preserving old urls", () => {
  assertEquals(
    summarizeAssistantMediaContent([
      "MISSY_GIF: https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif",
      "MISSY_MESSAGE_BREAK",
      "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
    ].join("\n")),
    "[sent a gif]",
  );
});

Deno.test("summarizes assistant Tenor gif links without preserving old urls", () => {
  assertEquals(
    summarizeAssistantMediaContent(
      "MISSY_GIF: https://tenor.com/view/haha-gif-24708187",
    ),
    "[sent a gif]",
  );
});

Deno.test("keeps assistant text while summarizing attached media", () => {
  assertEquals(
    summarizeAssistantMediaContent([
      "try it and find out",
      "MISSY_MESSAGE_BREAK",
      "MISSY_GIF: https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
    ].join("\n")),
    "try it and find out\n[sent a gif]",
  );
});
