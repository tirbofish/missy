import { assertStringIncludes } from "@std/assert";
import { formatReactionPrompt } from "./reactions.ts";

Deno.test("formats reaction events with no-reply guidance", () => {
  const prompt = formatReactionPrompt({
    emoji: ":thumbsup:",
    messageAuthor: "missy",
    messageContent: "done",
    user: "big t",
  });

  assertStringIncludes(
    prompt,
    "big t replied to this message from missy with :thumbsup:",
  );
  assertStringIncludes(prompt, "done");
  assertStringIncludes(prompt, "MISSY_NO_REPLY");
  assertStringIncludes(prompt, "MISSY_REACT");
});

Deno.test("reaction prompts include attachments", () => {
  const prompt = formatReactionPrompt({
    attachments: [{
      contentType: "image/png",
      name: "file.png",
      url: "https://cdn.example/file.png",
    }],
    emoji: ":fire:",
    messageAuthor: "sam",
    messageContent: "",
    ownMessage: true,
    user: "big t",
  });

  assertStringIncludes(prompt, "[no text content]");
  assertStringIncludes(prompt, "one of your own messages");
  assertStringIncludes(prompt, "image");
  assertStringIncludes(prompt, "https://cdn.example/file.png");
});

Deno.test("tomato reactions are framed as booing", () => {
  const prompt = formatReactionPrompt({
    emoji: "🍅",
    messageAuthor: "missy",
    messageContent: "take",
    user: "big t",
  });

  assertStringIncludes(prompt, "throwing a tomato");
  assertStringIncludes(prompt, "booing");
  assertStringIncludes(prompt, "not literal tomato");
});

Deno.test("real tomato emoji reactions are framed as booing", () => {
  const prompt = formatReactionPrompt({
    emoji: "\u{1F345}",
    messageAuthor: "missy",
    messageContent: "take",
    user: "big t",
  });

  assertStringIncludes(prompt, "throwing a tomato");
  assertStringIncludes(prompt, "booing");
  assertStringIncludes(prompt, "not literal tomato");
});
