import { assertStringIncludes } from "@std/assert";
import { formatReactionPrompt } from "./reactions.ts";

Deno.test("formats reaction events with no-reply guidance", () => {
  const prompt = formatReactionPrompt({
    emoji: ":thumbsup:",
    messageAuthor: "missy",
    messageContent: "done",
    user: "big t",
  });

  assertStringIncludes(prompt, "big t reacted with :thumbsup:");
  assertStringIncludes(prompt, "this message from missy");
  assertStringIncludes(prompt, "done");
  assertStringIncludes(prompt, "MISSY_NO_REPLY");
  assertStringIncludes(prompt, "MISSY_REACT");
});

Deno.test("reaction prompts include attachments", () => {
  const prompt = formatReactionPrompt({
    attachmentUrls: ["https://cdn.example/file.png"],
    emoji: ":fire:",
    messageAuthor: "sam",
    messageContent: "",
    user: "big t",
  });

  assertStringIncludes(prompt, "[no text content]");
  assertStringIncludes(prompt, "https://cdn.example/file.png");
});
